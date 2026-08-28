import { EnvSecretsAdapter } from '../../src/l0/adapters/env/env-secrets.adapter';
import { RuntimeRole } from '../../src/platform/runtime/role';
import {
  ConfigValidationError,
  loadAndValidateConfig,
  resetAppConfigForTests,
  setAppConfig,
} from '../../src/platform/config';

describe('boot validation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetAppConfigForTests();
  });

  it('fails fast with a clear message when a required secret is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.REDIS_URL = 'redis://localhost:6379';

    const secrets = new EnvSecretsAdapter();
    expect(() => loadAndValidateConfig(secrets, RuntimeRole.Api)).toThrow(
      ConfigValidationError,
    );
    expect(() => loadAndValidateConfig(secrets, RuntimeRole.Api)).toThrow(
      'Missing required configuration: DATABASE_URL',
    );
  });

  it('does not write a stack trace to stdout on validation failure', () => {
    delete process.env.DATABASE_URL;
    process.env.REDIS_URL = 'redis://localhost:6379';

    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const secrets = new EnvSecretsAdapter();

    try {
      loadAndValidateConfig(secrets, RuntimeRole.Api);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
    }

    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('loads a frozen configuration after successful validation', () => {
    process.env.DATABASE_URL = 'postgres://dhund:dhund@localhost:5432/dhund';
    process.env.REDIS_URL = 'redis://localhost:6379';

    const secrets = new EnvSecretsAdapter();
    const config = loadAndValidateConfig(secrets, RuntimeRole.Api);
    setAppConfig(config);

    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as { port: number }).port = 4000;
    }).toThrow();
  });
});
