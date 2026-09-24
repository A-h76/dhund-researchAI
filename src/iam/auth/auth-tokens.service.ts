import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_EVENT,
  AUTH_TOKEN_STORE,
  EMAIL_SERVICE,
  OUTBOX_SERVICE,
  SESSION_STORE,
  type AuditEventPort,
  type AuthTokenPurpose,
  type AuthTokenStore,
  type ConsumeOutcome,
  type EmailService,
  type OutboxPort,
  type SessionStore,
} from '../../l0/ports';
import { DomainError, ErrorCode } from '../../platform/errors';
import { OutboxWriterService } from '../../platform/events';
import { generateId } from '../../platform/ids/uuid-v7';
import { PlatformLogger, requireCorrelationId } from '../../platform/logging';
import { auditedAppendInput } from '../../platform/observability/audit-action';
import { PASSWORD_HASHER, type PasswordHasher } from '../password/password-hasher';
import { PasswordPolicy } from '../password/password-policy';
import { hashAuthToken } from '../tokens/auth-token';
import {
  EMAIL_VERIFICATION_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
} from '../tokens/auth-token.constants';
import { AuthTokenService } from '../tokens/auth-token.service';
import { AuthTokenMetrics } from './auth-token.metrics';
import {
  parseEmailRequest,
  parsePasswordResetRequest,
  parseTokenRequest,
} from './parse-auth-request';

export const AUTH_ACCEPTED_BODY = { status: 'accepted' } as const;
export type AuthAcceptedResponse = typeof AUTH_ACCEPTED_BODY;

const VERIFY_SUBJECT = 'Verify your email';
const RESET_SUBJECT = 'Reset your password';

@Injectable()
export class AuthTokensService {
  constructor(
    private readonly signer: AuthTokenService,
    @Inject(AUTH_TOKEN_STORE) private readonly tokens: AuthTokenStore,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
    @Inject(OUTBOX_SERVICE) private readonly outbox: OutboxPort,
    private readonly outboxWriter: OutboxWriterService,
    private readonly policy: PasswordPolicy,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly metrics: AuthTokenMetrics,
    private readonly logger: PlatformLogger,
    @Inject(AUDIT_EVENT) private readonly audit: AuditEventPort,
  ) {}

  async afterRegister(userId: string, email: string): Promise<void> {
    try {
      const token = await this.issue('email_verification', userId);
      await this.sendQuietly({
        to: email,
        subject: VERIFY_SUBJECT,
        html: tokenHtml(token),
      });
    } catch {
      this.logger.warn({
        module: 'iam',
        message: 'verification.issue_failed',
      });
    }
  }

  async verifyEmail(body: unknown): Promise<void> {
    const { token } = parseTokenRequest(body);
    await this.verifySignature(token, 'email_verification');
    const tokenHash = hashAuthToken(token);
    const now = new Date();

    const result = await this.outbox.withTransaction(async (tx) => {
      const outcome = await this.tokens.consumeIfUnspent(tx, {
        tokenHash,
        purpose: 'email_verification',
        now,
      });
      if (outcome.status !== 'consumed') {
        return outcome;
      }

      await this.tokens.markEmailVerified(tx, outcome.token.userId, now);
      if (outcome.token.orgId !== null && outcome.token.email.length > 0) {
        await this.outboxWriter.appendInTransaction(tx, {
          eventType: 'iam.user.email_verified',
          aggregateType: 'user',
          aggregateId: outcome.token.userId,
          orgId: outcome.token.orgId,
          payload: {
            orgId: outcome.token.orgId,
            userId: outcome.token.userId,
            email: outcome.token.email,
          },
        });
      }
      return outcome;
    });

    this.finishConsume(result);
  }

  async resendVerification(body: unknown): Promise<AuthAcceptedResponse> {
    const { email } = parseEmailRequest(body);
    const identity = await this.sessions.findLoginByEmail(email);
    if (identity !== null && identity.emailVerifiedAt === null) {
      const token = await this.issue('email_verification', identity.userId);
      await this.sendQuietly({
        to: email,
        subject: VERIFY_SUBJECT,
        html: tokenHtml(token),
      });
    } else {
      await this.signDummy('email_verification', EMAIL_VERIFICATION_TTL_SECONDS);
    }
    return AUTH_ACCEPTED_BODY;
  }

  async requestPasswordReset(body: unknown): Promise<AuthAcceptedResponse> {
    const { email } = parseEmailRequest(body);
    const identity = await this.sessions.findLoginByEmail(email);
    if (identity !== null && identity.passwordHash !== null) {
      const token = await this.issue('password_reset', identity.userId);
      await this.sendQuietly({
        to: email,
        subject: RESET_SUBJECT,
        html: tokenHtml(token),
      });
    } else {
      await this.signDummy('password_reset', PASSWORD_RESET_TTL_SECONDS);
    }
    return AUTH_ACCEPTED_BODY;
  }

  async resetPassword(body: unknown): Promise<void> {
    const parsed = parsePasswordResetRequest(body);
    await this.policy.assertAcceptable(parsed.password);
    await this.verifySignature(parsed.token, 'password_reset');
    const passwordHash = await this.hasher.hash(parsed.password);
    const tokenHash = hashAuthToken(parsed.token);
    const now = new Date();

    const result = await this.outbox.withTransaction(async (tx) => {
      const outcome = await this.tokens.consumeIfUnspent(tx, {
        tokenHash,
        purpose: 'password_reset',
        now,
      });
      if (outcome.status !== 'consumed') {
        return outcome;
      }

      await this.tokens.updatePasswordHash(tx, outcome.token.userId, passwordHash);
      const logout = await this.sessions.logoutAll(
        tx,
        outcome.token.userId,
        now,
        'password_reset',
      );
      if (logout.orgId !== null) {
        for (const sessionId of logout.sessionIds) {
          await this.outboxWriter.appendInTransaction(tx, {
            eventType: 'iam.session.revoked',
            aggregateType: 'session',
            aggregateId: sessionId,
            orgId: logout.orgId,
            payload: {
              orgId: logout.orgId,
              userId: outcome.token.userId,
              sessionId,
              reason: 'password_reset',
            },
          });
        }
      }
      return outcome;
    });

    if (result.status === 'consumed') {
      await this.audit.append(
        auditedAppendInput({
          id: generateId(),
          actorType: 'user',
          actorId: result.token.userId,
          action: 'iam.password.reset',
          target: result.token.userId,
          correlationId: requireCorrelationId(),
          scope: { userId: result.token.userId },
        }),
      );
    }

    this.finishConsume(result);
  }

  async issue(purpose: AuthTokenPurpose, userId: string): Promise<string> {
    const id = generateId();
    const ttlSeconds =
      purpose === 'email_verification'
        ? EMAIL_VERIFICATION_TTL_SECONDS
        : PASSWORD_RESET_TTL_SECONDS;
    const token = await this.signer.sign({
      sub: userId,
      purpose,
      jti: id,
      ttlSeconds,
    });
    const now = new Date();
    await this.outbox.withTransaction(async (tx) => {
      await this.tokens.replaceOutstanding(tx, {
        id,
        userId,
        purpose,
        tokenHash: hashAuthToken(token),
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      });
    });
    this.metrics.recordIssued();
    return token;
  }

  private async verifySignature(
    token: string,
    purpose: AuthTokenPurpose,
  ): Promise<void> {
    try {
      await this.signer.verify(token, purpose);
    } catch (error) {
      this.metrics.recordRejected();
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(ErrorCode.TokenInvalid, { module: 'iam' });
    }
  }

  private async signDummy(
    purpose: AuthTokenPurpose,
    ttlSeconds: number,
  ): Promise<void> {
    await this.signer.sign({
      sub: generateId(),
      purpose,
      jti: generateId(),
      ttlSeconds,
    });
  }

  private finishConsume(result: ConsumeOutcome): void {
    if (result.status === 'consumed') {
      this.metrics.recordConsumed();
      return;
    }
    if (result.status === 'expired') {
      this.metrics.recordExpired();
    } else {
      this.metrics.recordRejected();
    }
    throw new DomainError(ErrorCode.TokenInvalid, { module: 'iam' });
  }

  private async sendQuietly(params: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    try {
      await this.email.send(params, requireCorrelationId());
    } catch {
      this.logger.warn({
        module: 'iam',
        message: 'email.send_failed',
      });
    }
  }
}

function tokenHtml(token: string): string {
  return `<p>${token}</p>`;
}
