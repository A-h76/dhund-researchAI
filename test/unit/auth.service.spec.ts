import { AuthMetrics } from '../../src/iam/auth/auth.metrics';
import { AuthService } from '../../src/iam/auth/auth.service';
import { DUMMY_ARGON2_HASH } from '../../src/iam/password/dummy-hash';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { hashRefreshToken, parseRefreshToken } from '../../src/iam/tokens/refresh-token';
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
import { MemorySessionStore } from '../fixtures/memory-session-store';

const PASSWORD = 'valid-password-12';
const STORED_HASH = '$argon2id$stored-hash';

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

describe('AuthService', () => {
  const jwt = generateTestJwtConfig();
  const userId = generateId();
  const orgId = generateId();
  const email = 'login@example.com';

  let store: MemorySessionStore;
  let hasher: { hash: jest.Mock; verify: jest.Mock };
  let service: AuthService;
  let tokens: AccessTokenService;
  let appended: ReturnType<typeof capturingOutbox>['appended'];
  let metrics: AuthMetrics;
  let lines: unknown[];

  beforeEach(() => {
    store = new MemorySessionStore();
    store.seedUser(email, {
      userId,
      sessionVersion: 1,
      passwordHash: STORED_HASH,
      orgId,
      emailVerifiedAt: null,
    });
    hasher = {
      hash: jest.fn(),
      verify: jest.fn(async (_password: string, encodedHash: string) => {
        return encodedHash === STORED_HASH;
      }),
    };
    const { logger, lines: captured } = capturingLogger();
    lines = captured;
    metrics = new AuthMetrics(logger);
    const { outbox, appended: rows } = capturingOutbox();
    appended = rows;
    const config = installTestAppConfig({ jwt });
    tokens = new AccessTokenService(config, store);
    service = new AuthService(
      hasher,
      store,
      outbox,
      new OutboxWriterService(outbox),
      tokens,
      metrics,
    );
  });

  it('logs in, creates a session and family, and emits iam.session.created', async () => {
    hasher.verify.mockImplementation(async (password: string, encodedHash: string) => {
      return password === PASSWORD && encodedHash === STORED_HASH;
    });

    const result = await runWithCorrelationIdAsync('cor-login-1', () =>
      service.login({ email, password: PASSWORD }),
    );

    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(900);
    expect(Object.keys(result).sort()).toEqual(
      ['accessToken', 'expiresIn', 'refreshToken', 'tokenType'].sort(),
    );
    expect(store.sessions.size).toBe(1);
    expect(store.families.size).toBe(1);
    const family = [...store.families.values()][0];
    expect(family.currentTokenHash).toBe(hashRefreshToken(result.refreshToken));
    expect(family.currentTokenHash).not.toBe(result.refreshToken);
    expect(appended.map((row) => row.eventType)).toEqual(['iam.session.created']);
    const payload = appended[0].payload as { data?: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      orgId,
      userId,
      sessionId: family.sessionId,
      familyId: family.familyId,
    });
    expect(JSON.stringify(appended)).not.toContain(PASSWORD);
    expect(JSON.stringify(appended)).not.toContain(result.refreshToken);
    expect(JSON.stringify(appended)).not.toContain(result.accessToken);
    expect(metrics.snapshot().loginSuccess).toBe(1);
    expect(metrics.hasOracleKeys()).toBe(false);
    await expect(tokens.verify(result.accessToken)).resolves.toMatchObject({
      sub: userId,
      sid: family.sessionId,
      sv: 1,
    });
  });

  it('always verifies against the dummy hash for an unknown email', async () => {
    hasher.verify.mockResolvedValue(false);
    await expect(
      runWithCorrelationIdAsync('cor-login-unknown', () =>
        service.login({ email: 'missing@example.com', password: PASSWORD }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidCredentials });

    expect(hasher.verify).toHaveBeenCalledWith(PASSWORD, DUMMY_ARGON2_HASH);
    expect(metrics.snapshot().loginFailure).toBe(1);
    expect(store.sessions.size).toBe(0);
  });

  it('always verifies the stored hash for a wrong password', async () => {
    hasher.verify.mockResolvedValue(false);
    await expect(
      runWithCorrelationIdAsync('cor-login-wrong', () =>
        service.login({ email, password: 'wrong-password-12' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidCredentials });

    expect(hasher.verify).toHaveBeenCalledWith('wrong-password-12', STORED_HASH);
    expect(metrics.snapshot().loginFailure).toBe(1);
  });

  it('rotates refresh tokens and rejects the previous token as reuse', async () => {
    hasher.verify.mockResolvedValue(true);
    const first = await runWithCorrelationIdAsync('cor-refresh-1', () =>
      service.login({ email, password: PASSWORD }),
    );
    const rotated = await runWithCorrelationIdAsync('cor-refresh-2', () =>
      service.refresh({ refreshToken: first.refreshToken }),
    );

    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    const family = [...store.families.values()][0];
    expect(family.currentTokenHash).toBe(hashRefreshToken(rotated.refreshToken));
    expect(metrics.snapshot().refreshRotation).toBe(1);

    await expect(
      runWithCorrelationIdAsync('cor-refresh-3', () =>
        service.refresh({ refreshToken: first.refreshToken }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RefreshReuseDetected });

    expect(family.familyId).toBe(parseRefreshToken(first.refreshToken)?.familyId);
    expect(store.families.get(family.familyId)?.revokedAt).not.toBeNull();
    expect(store.sessions.get(family.sessionId)?.revokedAt).not.toBeNull();
    expect(appended.map((row) => row.eventType)).toEqual(
      expect.arrayContaining([
        'iam.refresh_token.family_revoked',
        'iam.session.revoked',
      ]),
    );
    const revoked = appended.find((row) => row.eventType === 'iam.session.revoked');
    const revokedPayload = revoked?.payload as { data?: { reason?: string } };
    expect(revokedPayload.data?.reason).toBe('refresh_reuse');
    expect(metrics.snapshot().refreshFamilyRevoked).toBe(1);
    expect(JSON.stringify(lines)).toContain('refresh.family_revoked');
    expect(JSON.stringify(lines)).not.toContain(first.refreshToken);
    expect(JSON.stringify(lines)).not.toContain(PASSWORD);
  });

  it('returns refresh_invalid for malformed, unknown, and already revoked families', async () => {
    await expect(
      runWithCorrelationIdAsync('cor-bad-1', () =>
        service.refresh({ refreshToken: 'not-a-token' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RefreshInvalid });

    await expect(
      runWithCorrelationIdAsync('cor-bad-2', () =>
        service.refresh({ refreshToken: `${generateId()}.secret` }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RefreshInvalid });

    hasher.verify.mockResolvedValue(true);
    const login = await runWithCorrelationIdAsync('cor-bad-3', () =>
      service.login({ email, password: PASSWORD }),
    );
    await runWithCorrelationIdAsync('cor-bad-4', () =>
      service.refresh({ refreshToken: login.refreshToken }),
    );
    await expect(
      runWithCorrelationIdAsync('cor-bad-5', () =>
        service.refresh({ refreshToken: login.refreshToken }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RefreshReuseDetected });

    const familyId = parseRefreshToken(login.refreshToken)!.familyId;
    await expect(
      runWithCorrelationIdAsync('cor-bad-6', () =>
        service.refresh({
          refreshToken: `${familyId}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
        }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RefreshInvalid });
  });

  it('keeps a second family valid after reuse on the first', async () => {
    hasher.verify.mockResolvedValue(true);
    const deviceA = await runWithCorrelationIdAsync('cor-dev-a', () =>
      service.login({ email, password: PASSWORD }),
    );
    const deviceB = await runWithCorrelationIdAsync('cor-dev-b', () =>
      service.login({ email, password: PASSWORD }),
    );
    const rotatedA = await runWithCorrelationIdAsync('cor-dev-a2', () =>
      service.refresh({ refreshToken: deviceA.refreshToken }),
    );
    await expect(
      runWithCorrelationIdAsync('cor-dev-reuse', () =>
        service.refresh({ refreshToken: deviceA.refreshToken }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RefreshReuseDetected });

    const stillB = await runWithCorrelationIdAsync('cor-dev-b2', () =>
      service.refresh({ refreshToken: deviceB.refreshToken }),
    );
    expect(stillB.refreshToken).not.toBe(deviceB.refreshToken);
    expect(rotatedA.accessToken).toBeTruthy();
  });

  it('logout-all bumps sessionVersion and revokes every family', async () => {
    hasher.verify.mockResolvedValue(true);
    const first = await runWithCorrelationIdAsync('cor-lo-1', () =>
      service.login({ email, password: PASSWORD }),
    );
    const second = await runWithCorrelationIdAsync('cor-lo-2', () =>
      service.login({ email, password: PASSWORD }),
    );

    await runWithCorrelationIdAsync('cor-lo-3', () =>
      service.logoutAll(`Bearer ${first.accessToken}`),
    );

    expect(store.usersById.get(userId)?.sessionVersion).toBe(2);
    for (const session of store.sessions.values()) {
      expect(session.revokedAt).not.toBeNull();
    }
    for (const family of store.families.values()) {
      expect(family.revokedAt).not.toBeNull();
    }
    await expect(tokens.verify(first.accessToken)).rejects.toMatchObject({
      code: ErrorCode.SessionRevoked,
    });
    await expect(tokens.verify(second.accessToken)).rejects.toMatchObject({
      code: ErrorCode.SessionRevoked,
    });
    await expect(
      runWithCorrelationIdAsync('cor-lo-4', () =>
        service.refresh({ refreshToken: first.refreshToken }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.RefreshInvalid });
    expect(
      appended.filter((row) => row.eventType === 'iam.session.revoked').length,
    ).toBeGreaterThanOrEqual(2);
  });
});
