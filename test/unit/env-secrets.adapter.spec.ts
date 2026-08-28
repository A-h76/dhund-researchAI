import { EnvSecretsAdapter } from '../../src/l0/adapters/env/env-secrets.adapter';

describe('EnvSecretsAdapter', () => {
  const original = process.env.TEST_SECRET_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TEST_SECRET_KEY;
    } else {
      process.env.TEST_SECRET_KEY = original;
    }
  });

  it('reads configured secrets from environment', () => {
    process.env.TEST_SECRET_KEY = 'local-test-value';
    const adapter = new EnvSecretsAdapter();
    expect(adapter.getSecret('TEST_SECRET_KEY')).toBe('local-test-value');
  });

  it('returns undefined for missing secrets', () => {
    delete process.env.TEST_SECRET_KEY;
    const adapter = new EnvSecretsAdapter();
    expect(adapter.getSecret('TEST_SECRET_KEY')).toBeUndefined();
  });
});
