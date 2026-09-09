import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RegistrationConflictError,
  type OutboxPort,
  type RegistrationStore,
} from '../../src/l0/ports';
import { PasswordPolicy } from '../../src/iam/password/password-policy';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import {
  REGISTER_SUCCESS_BODY,
  RegistrationService,
} from '../../src/iam/registration/registration.service';
import { OutboxWriterService } from '../../src/platform/events';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import {
  PlatformLogger,
  runWithCorrelationIdAsync,
} from '../../src/platform/logging';

const PASSWORD = 'valid-password-12';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$abc';

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

function buildService(options?: {
  verdict?: 'breached' | 'clear' | 'unavailable';
  conflict?: boolean;
}): {
  service: RegistrationService;
  hasher: { hash: jest.Mock };
  store: { insert: jest.Mock };
  metrics: RegistrationMetrics;
  lines: unknown[];
  order: string[];
} {
  const { logger, lines } = capturingLogger();
  const order: string[] = [];
  const hasher = {
    hash: jest.fn(async () => {
      order.push('hash');
      return HASH;
    }),
    verify: jest.fn(async () => false),
  };
  const store = {
    insert: jest.fn(async () => {
      order.push('insert');
      if (options?.conflict) {
        throw new RegistrationConflictError();
      }
    }),
  };
  const outbox: OutboxPort = {
    withTransaction: async (work) => work({} as never),
    append: async () => undefined,
    appendStateMarker: async () => undefined,
    listUnrelayedOrdered: async () => [],
    markRelayed: async () => undefined,
    incrementAttempt: async () => undefined,
    countUnrelayed: async () => 0,
    oldestUnrelayedCreatedAt: async () => null,
  };
  const metrics = new RegistrationMetrics(logger);
  const policy = new PasswordPolicy(
    { check: async () => options?.verdict ?? 'clear' },
    logger,
    metrics,
  );
  const service = new RegistrationService(
    policy,
    hasher,
    store as unknown as RegistrationStore,
    outbox,
    new OutboxWriterService(outbox),
    metrics,
  );

  return { service, hasher, store, metrics, lines, order };
}

describe('RegistrationService', () => {
  it('creates a new registration after hashing and returns the pending body', async () => {
    const { service, hasher, store, metrics, order } = buildService();

    const result = await runWithCorrelationIdAsync('cor-reg-1', () =>
      service.register({
        email: 'new@example.com',
        password: PASSWORD,
        displayName: 'Ada',
      }),
    );

    expect(result).toEqual(REGISTER_SUCCESS_BODY);
    expect(hasher.hash).toHaveBeenCalledTimes(1);
    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['hash', 'insert']);
    expect(metrics.snapshot().success).toBe(1);
    expect(metrics.hasOracleKeys()).toBe(false);
    expect(Object.keys(metrics.snapshot())).not.toEqual(
      expect.arrayContaining(['email_exists', 'email_taken', 'existing_user', 'duplicate_email']),
    );
  });

  it('hashes before the conflict path for an existing email and still returns the same body', async () => {
    const { service, hasher, store, metrics, order, lines } = buildService({
      conflict: true,
    });

    const result = await runWithCorrelationIdAsync('cor-reg-2', () =>
      service.register({
        email: 'existing@example.com',
        password: PASSWORD,
      }),
    );

    expect(result).toEqual(REGISTER_SUCCESS_BODY);
    expect(hasher.hash).toHaveBeenCalledTimes(1);
    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['hash', 'insert']);
    expect(metrics.snapshot().success).toBe(1);
    expect(JSON.stringify(lines)).not.toContain(PASSWORD);
  });

  it('continues registration when the breach list is unavailable', async () => {
    const { service, store, lines, metrics } = buildService({
      verdict: 'unavailable',
    });

    const result = await runWithCorrelationIdAsync('cor-reg-3', () =>
      service.register({ email: 'degraded@example.com', password: PASSWORD }),
    );

    expect(result).toEqual(REGISTER_SUCCESS_BODY);
    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(metrics.snapshot().breachListDegraded).toBe(1);
    expect(JSON.stringify(lines)).toContain('password.breach_list.degraded');
    expect(JSON.stringify(lines)).not.toContain(PASSWORD);
  });

  it('does not insert when the password is too short', async () => {
    const { service, hasher, store, metrics } = buildService();

    await expect(
      runWithCorrelationIdAsync('cor-reg-4', () =>
        service.register({ email: 'short@example.com', password: 'abcdefghijk' }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });

    expect(hasher.hash).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
    expect(metrics.snapshot().validationFailure).toBe(1);
  });

  it('does not look up email before hashing', () => {
    const source = readFileSync(
      join(__dirname, '../../src/iam/registration/registration.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/findUnique|findFirst|findUserByEmail/);
  });
});
