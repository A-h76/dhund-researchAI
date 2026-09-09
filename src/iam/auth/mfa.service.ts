import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  MFA_STORE,
  OUTBOX_SERVICE,
  SESSION_STORE,
  type MfaStore,
  type OutboxPort,
  type OutboxTransaction,
  type SessionStore,
} from '../../l0/ports';
import { APP_CONFIG, type FrozenAppConfig } from '../../platform/config';
import { DomainError, ErrorCode } from '../../platform/errors';
import { generateId } from '../../platform/ids/uuid-v7';
import { generateRecoveryCodes, hashRecoveryCode } from '../mfa/recovery-code';
import { encodeBase32, otpauthUrl, verifyTotp } from '../mfa/totp';
import { unwrapTotpSecret, wrapTotpSecret } from '../mfa/totp-wrap';
import { AccessTokenService } from '../tokens/access-token.service';
import { MfaChallengeService } from '../tokens/mfa-challenge.service';
import { AuthService, type TokenPairResponse } from './auth.service';
import { MfaMetrics } from './mfa.metrics';
import {
  parseMfaFactorRequest,
  parseMfaVerifyRequest,
  parseTotpCodeRequest,
  readBearerToken,
} from './parse-auth-request';

export interface TotpEnrolResponse {
  readonly secret: string;
  readonly otpauthUrl: string;
}

export interface RecoveryCodesResponse {
  readonly recoveryCodes: readonly string[];
}

@Injectable()
export class MfaService {
  private readonly wrapKey: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) config: FrozenAppConfig,
    @Inject(MFA_STORE) private readonly mfa: MfaStore,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(OUTBOX_SERVICE) private readonly outbox: OutboxPort,
    private readonly accessTokens: AccessTokenService,
    private readonly challenges: MfaChallengeService,
    private readonly auth: AuthService,
    private readonly metrics: MfaMetrics,
  ) {
    if (config.totpWrapKey === undefined) {
      throw new Error('Missing TOTP wrap-key configuration');
    }
    this.wrapKey = config.totpWrapKey;
  }

  async enrol(authorization: string | undefined): Promise<TotpEnrolResponse> {
    const userId = (await this.requireBearer(authorization)).sub;
    const existing = await this.mfa.getTotp(userId);
    if (existing?.enabledAt != null) {
      throw new DomainError(ErrorCode.InvalidStateTransition, { module: 'iam' });
    }

    const secret = randomBytes(20);
    const ciphertext = wrapTotpSecret(secret, this.wrapKey);
    await this.outbox.withTransaction(async (tx) => {
      await this.mfa.upsertPendingTotp(tx, {
        id: generateId(),
        userId,
        ciphertext,
      });
    });

    const encoded = encodeBase32(secret);
    return { secret: encoded, otpauthUrl: otpauthUrl(userId, encoded) };
  }

  async confirm(
    authorization: string | undefined,
    body: unknown,
  ): Promise<RecoveryCodesResponse> {
    const userId = (await this.requireBearer(authorization)).sub;
    const { code } = parseTotpCodeRequest(body);
    const totp = await this.requirePendingTotp(userId);
    this.assertTotp(totp.ciphertext, code);

    const recoveryCodes = generateRecoveryCodes();
    const enabledAt = new Date();
    await this.outbox.withTransaction(async (tx) => {
      await this.mfa.enableTotp(tx, userId, enabledAt);
      await this.mfa.replaceRecoveryCodes(tx, userId, hashedRecoveryInserts(recoveryCodes));
    });

    return { recoveryCodes };
  }

  async disable(authorization: string | undefined, body: unknown): Promise<void> {
    const userId = (await this.requireBearer(authorization)).sub;
    const factor = parseMfaFactorRequest(body);
    const totp = await this.requireEnabledTotp(userId);

    if (factor.code !== undefined) {
      this.assertTotp(totp.ciphertext, factor.code);
      await this.outbox.withTransaction(async (tx) => {
        await this.mfa.disableTotp(tx, userId);
      });
      return;
    }

    await this.consumeRecoveryThen(userId, factor.recoveryCode!, async (tx) => {
      await this.mfa.disableTotp(tx, userId);
    });
  }

  async issueRecovery(
    authorization: string | undefined,
    body: unknown,
  ): Promise<RecoveryCodesResponse> {
    const userId = (await this.requireBearer(authorization)).sub;
    const { code } = parseTotpCodeRequest(body);
    const totp = await this.requireEnabledTotp(userId);
    this.assertTotp(totp.ciphertext, code);

    const recoveryCodes = generateRecoveryCodes();
    await this.outbox.withTransaction(async (tx) => {
      await this.mfa.replaceRecoveryCodes(tx, userId, hashedRecoveryInserts(recoveryCodes));
    });
    return { recoveryCodes };
  }

  async verify(body: unknown): Promise<TokenPairResponse> {
    const parsed = parseMfaVerifyRequest(body);
    let userId: string;
    try {
      userId = (await this.challenges.verify(parsed.challengeToken)).sub;
    } catch (error) {
      this.metrics.recordFailure();
      throw error instanceof DomainError
        ? error
        : new DomainError(ErrorCode.MfaInvalid, { module: 'iam' });
    }

    const identity = await this.sessions.findLoginByUserId(userId);
    if (identity === null || identity.orgId === null || !identity.mfaEnabled) {
      this.metrics.recordFailure();
      throw new DomainError(ErrorCode.MfaInvalid, { module: 'iam' });
    }

    if (parsed.code !== undefined) {
      const totp = await this.requireEnabledTotp(userId);
      try {
        this.assertTotp(totp.ciphertext, parsed.code);
      } catch (error) {
        this.metrics.recordFailure();
        throw error;
      }
    } else {
      try {
        await this.consumeRecoveryThen(userId, parsed.recoveryCode!, async () => undefined);
      } catch (error) {
        this.metrics.recordFailure();
        throw error;
      }
      this.metrics.recordRecoveryRedeemed();
    }

    const pair = await this.auth.issueSession(identity);
    this.metrics.recordSuccess();
    return pair;
  }

  private async requireBearer(authorization: string | undefined) {
    return this.accessTokens.verify(readBearerToken(authorization));
  }

  private async requirePendingTotp(userId: string) {
    const totp = await this.mfa.getTotp(userId);
    if (totp === null || totp.enabledAt !== null) {
      throw new DomainError(ErrorCode.InvalidStateTransition, { module: 'iam' });
    }
    return totp;
  }

  private async requireEnabledTotp(userId: string) {
    const totp = await this.mfa.getTotp(userId);
    if (totp === null || totp.enabledAt === null) {
      throw new DomainError(ErrorCode.InvalidStateTransition, { module: 'iam' });
    }
    return totp;
  }

  private assertTotp(ciphertext: Uint8Array, code: string): void {
    let secret: Uint8Array;
    try {
      secret = unwrapTotpSecret(ciphertext, this.wrapKey);
    } catch {
      throw new DomainError(ErrorCode.MfaInvalid, { module: 'iam' });
    }
    if (!verifyTotp(secret, code)) {
      throw new DomainError(ErrorCode.MfaInvalid, { module: 'iam' });
    }
  }

  private async consumeRecoveryThen(
    userId: string,
    recoveryCode: string,
    after: (tx: OutboxTransaction) => Promise<unknown>,
  ): Promise<void> {
    const codeHash = hashRecoveryCode(recoveryCode);
    const now = new Date();
    await this.outbox.withTransaction(async (tx) => {
      const outcome = await this.mfa.consumeRecoveryCode(tx, userId, codeHash, now);
      if (outcome !== 'consumed') {
        throw new DomainError(ErrorCode.MfaRecoveryInvalid, { module: 'iam' });
      }
      await after(tx);
    });
  }
}

function hashedRecoveryInserts(codes: readonly string[]) {
  return codes.map((code) => ({
    id: generateId(),
    codeHash: hashRecoveryCode(code),
  }));
}
