import { AuthTokenMetrics } from '../../src/iam/auth/auth-token.metrics';
import {
  AUTH_ACCEPTED_BODY,
  AuthTokensService,
} from '../../src/iam/auth/auth-tokens.service';
import { PasswordPolicy } from '../../src/iam/password/password-policy';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import { hashAuthToken } from '../../src/iam/tokens/auth-token';
import { AuthTokenService } from '../../src/iam/tokens/auth-token.service';
import type { EmailSendParams } from '../../src/l0/ports';
import { OutboxWriterService } from '../../src/platform/events';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import {
  PlatformLogger,
  runWithCorrelationIdAsync,
} from '../../src/platform/logging';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { capturingOutbox } from '../fixtures/capturing-outbox';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemoryAuthTokenStore } from '../fixtures/memory-auth-token-store';
import { MemorySessionStore } from '../fixtures/memory-session-store';

const NEW_PASSWORD = 'brand-new-pass12';
const STORED_HASH = '$argon2id$stored-hash';
const NEW_HASH = '$argon2id$new-hash';

function capturingLogger(): { logger: PlatformLogger; lines: unknown[] } {
  const lines: unknown[] = [];
  const logger = {
    info: (fields: unknown) => lines.push(fields),
    warn: (fields: unknown) => lines.push(fields),
    error: (fields: unknown) => lines.push(fields),
    debug: (fields: unknown) => lines.push(fields),
  } as unknown as PlatformLogger;
  return { logger, lines };
}

function tokenFromHtml(html: string): string {
  const match = /<p>([^<]+)<\/p>/.exec(html);
  if (match === null) {
    throw new Error('missing token html');
  }
  return match[1];
}

describe('AuthTokensService', () => {
  const jwt = generateTestJwtConfig();
  const email = 'verify@example.com';
  const userId = generateId();
  const orgId = generateId();

  let sessions: MemorySessionStore;
  let tokens: MemoryAuthTokenStore;
  let sent: EmailSendParams[];
  let sendImpl: (params: EmailSendParams) => Promise<{ id: string }>;
  let hasher: { hash: jest.Mock; verify: jest.Mock };
  let service: AuthTokensService;
  let appended: ReturnType<typeof capturingOutbox>['appended'];
  let metrics: AuthTokenMetrics;
  let lines: unknown[];

  beforeEach(() => {
    sessions = new MemorySessionStore();
    tokens = new MemoryAuthTokenStore();
    sessions.seedUser(email, {
      userId,
      sessionVersion: 1,
      passwordHash: STORED_HASH,
      orgId,
      emailVerifiedAt: null,
    });
    tokens.seedUser(userId, {
      email,
      orgId,
      emailVerifiedAt: null,
      passwordHash: STORED_HASH,
    });
    sent = [];
    sendImpl = async (params) => {
      sent.push(params);
      return { id: 'msg-1' };
    };
    hasher = {
      hash: jest.fn(async () => NEW_HASH),
      verify: jest.fn(async () => false),
    };
    const { logger, lines: captured } = capturingLogger();
    lines = captured;
    metrics = new AuthTokenMetrics(logger);
    const { outbox, appended: rows } = capturingOutbox();
    appended = rows;
    const config = installTestAppConfig({ jwt });
    const registrationMetrics = new RegistrationMetrics(logger);
    service = new AuthTokensService(
      new AuthTokenService(config),
      tokens,
      sessions,
      { send: (params) => sendImpl(params) },
      outbox,
      new OutboxWriterService(outbox),
      new PasswordPolicy(
        { check: async () => 'clear' },
        logger,
        registrationMetrics,
      ),
      hasher,
      metrics,
      logger,
    );
  });

  it('issues a hashed verification token, latest token wins, and verify consumes once', async () => {
    const first = await runWithCorrelationIdAsync('cor-issue-1', () =>
      service.issue('email_verification', userId),
    );
    const second = await runWithCorrelationIdAsync('cor-issue-2', () =>
      service.issue('email_verification', userId),
    );
    expect(tokens.tokens.get(hashAuthToken(first))?.consumedAt).not.toBeNull();
    expect(tokens.tokens.get(hashAuthToken(second))?.consumedAt).toBeNull();
    expect(tokens.tokens.has(first)).toBe(false);
    expect(tokens.tokens.has(second)).toBe(false);

    await runWithCorrelationIdAsync('cor-verify-1', () =>
      service.verifyEmail({ token: second }),
    );
    expect(tokens.users.get(userId)?.emailVerifiedAt).not.toBeNull();
    expect(appended.map((row) => row.eventType)).toEqual(['iam.user.email_verified']);
    const payload = appended[0].payload as { data?: Record<string, unknown> };
    expect(payload.data).toMatchObject({ orgId, userId, email });
    expect(JSON.stringify(appended)).not.toContain(second);
    expect(JSON.stringify(lines)).not.toContain(second);
    expect(JSON.stringify(lines)).not.toContain(hashAuthToken(second));

    await expect(
      runWithCorrelationIdAsync('cor-verify-2', () =>
        service.verifyEmail({ token: second }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.TokenInvalid });
    await expect(
      runWithCorrelationIdAsync('cor-verify-3', () =>
        service.verifyEmail({ token: first }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.TokenInvalid });
    expect(metrics.snapshot().consumed).toBe(1);
    expect(metrics.hasOracleKeys()).toBe(false);
  });

  it('returns identical token_invalid for unknown, expired, and spent tokens', async () => {
    const token = await runWithCorrelationIdAsync('cor-states', () =>
      service.issue('email_verification', userId),
    );
    await runWithCorrelationIdAsync('cor-states', () =>
      service.verifyEmail({ token }),
    );

    const spent = await runWithCorrelationIdAsync('cor-states', async () => {
      try {
        await service.verifyEmail({ token });
        return 'missing';
      } catch (error) {
        return error as { code: string };
      }
    });
    const unknown = await runWithCorrelationIdAsync('cor-states', async () => {
      try {
        await service.verifyEmail({ token: 'not-a-token' });
        return 'missing';
      } catch (error) {
        return error as { code: string };
      }
    });

    const expiredToken = await runWithCorrelationIdAsync('cor-states', () =>
      service.issue('email_verification', userId),
    );
    const expiredHash = hashAuthToken(expiredToken);
    const stored = tokens.tokens.get(expiredHash);
    tokens.tokens.set(expiredHash, {
      ...stored!,
      expiresAt: new Date(Date.now() - 1000),
    });
    const expired = await runWithCorrelationIdAsync('cor-states', async () => {
      try {
        await service.verifyEmail({ token: expiredToken });
        return 'missing';
      } catch (error) {
        return error as { code: string };
      }
    });

    expect(spent).toMatchObject({ code: ErrorCode.TokenInvalid });
    expect(unknown).toEqual(spent);
    expect(expired).toEqual(spent);
    expect(metrics.snapshot().expired).toBe(1);
    expect(metrics.snapshot().rejected).toBeGreaterThanOrEqual(2);
  });

  it('resends for known unverified emails and is identical for unknown emails', async () => {
    const known = await runWithCorrelationIdAsync('cor-resend', () =>
      service.resendVerification({ email }),
    );
    const unknown = await runWithCorrelationIdAsync('cor-resend', () =>
      service.resendVerification({ email: 'missing@example.com' }),
    );
    expect(known).toEqual(AUTH_ACCEPTED_BODY);
    expect(unknown).toEqual(known);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(email);
    const token = tokenFromHtml(sent[0].html);
    expect(JSON.stringify(lines)).not.toContain(token);
    expect(JSON.stringify(lines)).not.toContain(email);
  });

  it('does not email already-verified users', async () => {
    sessions.seedUser(email, {
      userId,
      sessionVersion: 1,
      passwordHash: STORED_HASH,
      orgId,
      emailVerifiedAt: new Date(),
    });
    const result = await runWithCorrelationIdAsync('cor-resend-done', () =>
      service.resendVerification({ email }),
    );
    expect(result).toEqual(AUTH_ACCEPTED_BODY);
    expect(sent).toHaveLength(0);
  });

  it('swallows email send failures after issue', async () => {
    sendImpl = async () => {
      throw new Error('email down');
    };
    await expect(
      runWithCorrelationIdAsync('cor-send-fail', () =>
        service.afterRegister(userId, email),
      ),
    ).resolves.toBeUndefined();
    expect([...tokens.tokens.values()].some((row) => row.consumedAt === null)).toBe(
      true,
    );
    expect(JSON.stringify(lines)).toContain('email.send_failed');
    expect(JSON.stringify(lines)).not.toContain(email);
  });

  it('does not spend a reset token when the password is weak', async () => {
    const token = await runWithCorrelationIdAsync('cor-weak', () =>
      service.issue('password_reset', userId),
    );
    await expect(
      runWithCorrelationIdAsync('cor-weak', () =>
        service.resetPassword({ token, password: 'short' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(tokens.tokens.get(hashAuthToken(token))?.consumedAt).toBeNull();
    expect(tokens.users.get(userId)?.passwordHash).toBe(STORED_HASH);
  });

  it('hashes before consume and revokes sessions on password reset', async () => {
    const sessionId = generateId();
    const familyId = generateId();
    sessions.sessions.set(sessionId, {
      sessionId,
      userId,
      revokedAt: null,
      userSessionVersion: 1,
    });
    sessions.families.set(familyId, {
      familyId,
      userId,
      sessionId,
      currentTokenHash: 'old-hash',
      revokedAt: null,
      userSessionVersion: 1,
      orgId,
    });
    const token = await runWithCorrelationIdAsync('cor-reset', () =>
      service.issue('password_reset', userId),
    );
    const order: string[] = [];
    hasher.hash.mockImplementation(async () => {
      order.push('hash');
      return NEW_HASH;
    });
    const originalConsume = tokens.consumeIfUnspent.bind(tokens);
    tokens.consumeIfUnspent = async (tx, input) => {
      order.push('consume');
      return originalConsume(tx, input);
    };

    await runWithCorrelationIdAsync('cor-reset', () =>
      service.resetPassword({ token, password: NEW_PASSWORD }),
    );

    expect(order).toEqual(['hash', 'consume']);
    expect(tokens.users.get(userId)?.passwordHash).toBe(NEW_HASH);
    expect(sessions.families.get(familyId)?.revokedAt).not.toBeNull();
    expect(sessions.usersById.get(userId)?.sessionVersion).toBe(2);
    expect(appended.map((row) => row.eventType)).toEqual(['iam.session.revoked']);
    expect(
      (appended[0].payload as { data?: { reason?: string } }).data?.reason,
    ).toBe('password_reset');
    expect(JSON.stringify(appended)).not.toContain(token);
    expect(JSON.stringify(appended)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(lines)).not.toContain(token);
    expect(JSON.stringify(lines)).not.toContain(NEW_PASSWORD);
  });

  it('does not mark email verified when the flag write fails after consume', async () => {
    const token = await runWithCorrelationIdAsync('cor-inject', () =>
      service.issue('email_verification', userId),
    );
    tokens.failAfterConsume = true;
    await expect(
      runWithCorrelationIdAsync('cor-inject', () => service.verifyEmail({ token })),
    ).rejects.toThrow('injected-verify-failure');
    expect(tokens.users.get(userId)?.emailVerifiedAt).toBeNull();
  });
});
