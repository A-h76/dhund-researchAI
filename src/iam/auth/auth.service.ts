import { Inject, Injectable } from '@nestjs/common';
import {
  OUTBOX_SERVICE,
  SESSION_STORE,
  type OutboxPort,
  type RefreshFamilyRecord,
  type SessionStore,
} from '../../l0/ports';
import { DomainError, ErrorCode } from '../../platform/errors';
import { OutboxWriterService } from '../../platform/events';
import { generateId } from '../../platform/ids/uuid-v7';
import { DUMMY_ARGON2_HASH } from '../password/dummy-hash';
import { PASSWORD_HASHER, type PasswordHasher } from '../password/password-hasher';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ACCESS_TOKEN_TYPE,
} from '../tokens/access-token.constants';
import { AccessTokenService } from '../tokens/access-token.service';
import {
  formatRefreshToken,
  generateRefreshSecret,
  hashRefreshToken,
  parseRefreshToken,
} from '../tokens/refresh-token';
import { AuthMetrics } from './auth.metrics';
import { MfaMetrics } from './mfa.metrics';
import {
  parseLoginRequest,
  parseRefreshCredential,
  readBearerToken,
} from './parse-auth-request';
import { MfaChallengeService } from '../tokens/mfa-challenge.service';

export interface TokenPairResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: typeof ACCESS_TOKEN_TTL_SECONDS;
  readonly tokenType: typeof ACCESS_TOKEN_TYPE;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(OUTBOX_SERVICE) private readonly outbox: OutboxPort,
    private readonly outboxWriter: OutboxWriterService,
    private readonly accessTokens: AccessTokenService,
    private readonly metrics: AuthMetrics,
    private readonly challenges: MfaChallengeService,
    private readonly mfaMetrics: MfaMetrics,
  ) {}

  jwks(): ReturnType<AccessTokenService['jwks']> {
    return this.accessTokens.jwks();
  }

  async login(body: unknown): Promise<TokenPairResponse> {
    const parsed = parseLoginRequest(body);
    const identity = await this.sessions.findLoginByEmail(parsed.email);
    const storedHash = identity?.passwordHash ?? null;
    const hashToCheck = storedHash ?? DUMMY_ARGON2_HASH;
    const ok = await this.hasher.verify(parsed.password, hashToCheck);

    if (identity === null || storedHash === null || identity.orgId === null || !ok) {
      this.metrics.recordLoginFailure();
      throw new DomainError(ErrorCode.InvalidCredentials, { module: 'iam' });
    }

    if (identity.mfaEnabled) {
      const challengeToken = await this.challenges.sign(identity.userId);
      this.mfaMetrics.recordChallenge();
      throw new DomainError(ErrorCode.MfaRequired, {
        module: 'iam',
        details: { challengeToken },
      });
    }

    return this.issueSession(identity);
  }

  async issueSession(identity: {
    readonly userId: string;
    readonly sessionVersion: number;
    readonly orgId: string | null;
  }): Promise<TokenPairResponse> {
    if (identity.orgId === null) {
      this.metrics.recordLoginFailure();
      throw new DomainError(ErrorCode.InvalidCredentials, { module: 'iam' });
    }

    const sessionId = generateId();
    const familyId = generateId();
    const refreshToken = formatRefreshToken(familyId, generateRefreshSecret());
    const tokenHash = hashRefreshToken(refreshToken);
    const issuedAt = new Date();
    const orgId = identity.orgId;

    await this.outbox.withTransaction(async (tx) => {
      await this.sessions.createSessionFamily(tx, {
        sessionId,
        familyId,
        userId: identity.userId,
        sessionVersion: identity.sessionVersion,
        tokenHash,
        issuedAt,
      });
      await this.outboxWriter.appendInTransaction(tx, {
        eventType: 'iam.session.created',
        aggregateType: 'session',
        aggregateId: sessionId,
        orgId,
        payload: {
          orgId,
          userId: identity.userId,
          sessionId,
          familyId,
        },
      });
    });

    const accessToken = await this.accessTokens.sign({
      sub: identity.userId,
      sid: sessionId,
      sv: identity.sessionVersion,
    });

    this.metrics.recordLoginSuccess();
    return tokenPair(accessToken, refreshToken);
  }

  async refresh(body: unknown, cookieHeader?: string): Promise<TokenPairResponse> {
    const refreshToken = parseRefreshCredential(body, cookieHeader);
    const parsed = parseRefreshToken(refreshToken);
    if (parsed === undefined) {
      throw new DomainError(ErrorCode.RefreshInvalid, { module: 'iam' });
    }

    const presentedHash = hashRefreshToken(refreshToken);
    const family = await this.sessions.getRefreshFamily(parsed.familyId);
    if (family === null || family.revokedAt !== null) {
      throw new DomainError(ErrorCode.RefreshInvalid, { module: 'iam' });
    }

    if (family.currentTokenHash !== presentedHash) {
      await this.revokeForReuse(family);
      throw new DomainError(ErrorCode.RefreshReuseDetected, { module: 'iam' });
    }

    const nextRefresh = formatRefreshToken(family.familyId, generateRefreshSecret());
    const nextHash = hashRefreshToken(nextRefresh);
    const accessToken = await this.accessTokens.sign({
      sub: family.userId,
      sid: family.sessionId,
      sv: family.userSessionVersion,
    });

    await this.outbox.withTransaction(async (tx) => {
      await this.sessions.rotateFamilyHash(tx, family.familyId, nextHash);
    });

    this.metrics.recordRefreshRotation();
    return tokenPair(accessToken, nextRefresh);
  }

  async logoutAll(authorization: string | undefined): Promise<void> {
    const accessToken = readBearerToken(authorization);
    const verified = await this.accessTokens.verify(accessToken);
    const revokedAt = new Date();

    await this.outbox.withTransaction(async (tx) => {
      const result = await this.sessions.logoutAll(
        tx,
        verified.sub,
        revokedAt,
        'logout_all',
      );
      if (result.orgId === null) {
        return;
      }

      for (const sessionId of result.sessionIds) {
        await this.outboxWriter.appendInTransaction(tx, {
          eventType: 'iam.session.revoked',
          aggregateType: 'session',
          aggregateId: sessionId,
          orgId: result.orgId,
          payload: {
            orgId: result.orgId,
            userId: verified.sub,
            sessionId,
            reason: 'logout_all',
          },
        });
      }
    });
  }

  private async revokeForReuse(family: RefreshFamilyRecord): Promise<void> {
    const orgId = family.orgId;
    await this.outbox.withTransaction(async (tx) => {
      await this.sessions.revokeFamilyAndSession(tx, {
        familyId: family.familyId,
        sessionId: family.sessionId,
        reason: 'refresh_reuse',
      });

      if (orgId === null) {
        return;
      }

      await this.outboxWriter.appendInTransaction(tx, {
        eventType: 'iam.refresh_token.family_revoked',
        aggregateType: 'refresh_token_family',
        aggregateId: family.familyId,
        orgId,
        payload: {
          orgId,
          userId: family.userId,
          familyId: family.familyId,
          sessionId: family.sessionId,
        },
      });
      await this.outboxWriter.appendInTransaction(tx, {
        eventType: 'iam.session.revoked',
        aggregateType: 'session',
        aggregateId: family.sessionId,
        orgId,
        payload: {
          orgId,
          userId: family.userId,
          sessionId: family.sessionId,
          reason: 'refresh_reuse',
        },
      });
    });

    this.metrics.recordFamilyRevoked({
      familyId: family.familyId,
      sessionId: family.sessionId,
      reason: 'refresh_reuse',
    });
  }
}

function tokenPair(accessToken: string, refreshToken: string): TokenPairResponse {
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    tokenType: ACCESS_TOKEN_TYPE,
  };
}
