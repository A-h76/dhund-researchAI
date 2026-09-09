import { PasswordPolicy } from '../../src/iam/password/password-policy';
import type { BreachListPort } from '../../src/iam/password/breach-list.port';
import { RegistrationMetrics } from '../../src/iam/registration/registration.metrics';
import { DomainError } from '../../src/platform/errors/domain-error';
import {
  ErrorCode,
  PASSWORD_POLICY_MAX_LENGTH,
  PASSWORD_POLICY_MIN_LENGTH,
} from '../../src/platform/errors/error-codes';
import { PlatformLogger } from '../../src/platform/logging';

const SECRET = 'unit-policy-secret-12';

function createPolicy(verdict: 'breached' | 'clear' | 'unavailable' = 'clear'): {
  policy: PasswordPolicy;
  logs: unknown[];
  metrics: RegistrationMetrics;
} {
  const logs: unknown[] = [];
  const logger = {
    info: (fields: unknown) => logs.push(fields),
    warn: (fields: unknown) => logs.push(fields),
    error: (fields: unknown) => logs.push(fields),
    debug: (fields: unknown) => logs.push(fields),
  } as unknown as PlatformLogger;
  const metrics = new RegistrationMetrics(logger);
  const breachList: BreachListPort = {
    check: async () => verdict,
  };
  return {
    policy: new PasswordPolicy(breachList, logger, metrics),
    logs,
    metrics,
  };
}

describe('password policy (GAP-PASSWORD-01)', () => {
  it('rejects passwords shorter than 12 with min_length', async () => {
    const { policy } = createPolicy();

    await expect(policy.assertAcceptable('abcdefghijk')).rejects.toMatchObject({
      code: ErrorCode.ValidationError,
      details: {
        fields: [{ field: 'password', rule: 'min_length', min: PASSWORD_POLICY_MIN_LENGTH }],
      },
    });
  });

  it('rejects passwords longer than the configured maximum with max_length', async () => {
    const { policy } = createPolicy();
    const tooLong = 'a'.repeat(PASSWORD_POLICY_MAX_LENGTH + 1);

    await expect(policy.assertAcceptable(tooLong)).rejects.toMatchObject({
      code: ErrorCode.ValidationError,
      details: {
        fields: [{ field: 'password', rule: 'max_length' }],
      },
    });
  });

  it('rejects a breach-list hit with rule breached and no password in the error', async () => {
    const { policy } = createPolicy('breached');

    await expect(policy.assertAcceptable(SECRET)).rejects.toBeInstanceOf(DomainError);
    try {
      await policy.assertAcceptable(SECRET);
    } catch (error) {
      const domain = error as DomainError;
      expect(domain.details).toEqual({
        fields: [{ field: 'password', rule: 'breached' }],
      });
      expect(JSON.stringify(domain)).not.toContain(SECRET);
    }
  });

  it('accepts a 12-character password when the breach list is clear', async () => {
    const { policy } = createPolicy('clear');
    await expect(policy.assertAcceptable('abcdefghijkl')).resolves.toBeUndefined();
  });

  it('accepts a long passphrase when the breach list is clear', async () => {
    const { policy } = createPolicy('clear');
    await expect(
      policy.assertAcceptable('correct horse battery staple extra'),
    ).resolves.toBeUndefined();
  });

  it('degrades to accept when the breach list is unavailable and logs without the password', async () => {
    const { policy, logs, metrics } = createPolicy('unavailable');

    await policy.assertAcceptable(SECRET);

    expect(metrics.snapshot().breachListDegraded).toBe(1);
    const serialized = JSON.stringify(logs);
    expect(serialized).toContain('password.breach_list.degraded');
    expect(serialized).not.toContain(SECRET);
  });
});
