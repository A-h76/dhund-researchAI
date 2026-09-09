import type { SecretsService } from '../../src/l0/ports/secrets.port';
import { RuntimeRole } from '../../src/platform/runtime/role';
import {
  ConfigValidationError,
  loadAndValidateConfig,
  parseFeatureFlags,
  parseLogLevel,
  parsePort,
  parseRequiredSecret,
} from '../../src/platform/config';
import { jwtSecretRecord } from '../fixtures/jwt-keys.fixture';
import { generateTestTotpWrapKey } from '../fixtures/totp-wrap.fixture';

function createSecrets(values: Record<string, string | undefined>): SecretsService {
  return {
    getSecret: (name: string) => values[name],
    listSecretKeys: () => Object.keys(values),
  };
}

const JWT = jwtSecretRecord();

function apiSecrets(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    ...JWT,
    AUTH_TOTP_WRAP_KEY: generateTestTotpWrapKey(),
    ...overrides,
  };
}

describe('app config schema', () => {
  it('accepts a valid configuration', () => {
    const config = loadAndValidateConfig(
      createSecrets(
        apiSecrets({
          PORT: '3000',
          LOG_LEVEL: 'info',
          FEATURE_RESEARCH_RUNS: 'false',
        }),
      ),
      RuntimeRole.Api,
    );

    expect(config.databaseUrl).toContain('postgres://');
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.featureFlags.research_runs).toBe(false);
    expect(config.argon2).toEqual({
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    expect(config.loadedKeyNames).not.toContain('EMBEDDING_DIMENSION');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() =>
      loadAndValidateConfig(
        createSecrets({ REDIS_URL: 'redis://localhost:6379', ...JWT }),
        RuntimeRole.Api,
      ),
    ).toThrow(new ConfigValidationError('Missing required configuration: DATABASE_URL'));
  });

  it('rejects an invalid PORT', () => {
    expect(() => parsePort('70000', true)).toThrow(ConfigValidationError);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => parseLogLevel('verbose')).toThrow(ConfigValidationError);
  });

  it('rejects EMBEDDING_DIMENSION because dimension is schema-bound', () => {
    expect(() =>
      loadAndValidateConfig(
        createSecrets(
          apiSecrets({
            EMBEDDING_DIMENSION: '1536',
          }),
        ),
        RuntimeRole.Api,
      ),
    ).toThrow(
      new ConfigValidationError(
        'EMBEDDING_DIMENSION is not supported; embedding dimension is schema-bound at 1024',
      ),
    );
  });

  it('parses DATABASE_POOL_SIZE from secrets with default when unset', () => {
    const config = loadAndValidateConfig(
      createSecrets(apiSecrets()),
      RuntimeRole.Api,
    );

    expect(config.databasePoolSize).toBe(10);
  });

  it('rejects an invalid DATABASE_POOL_SIZE', () => {
    expect(() =>
      loadAndValidateConfig(
        createSecrets(
          apiSecrets({
            DATABASE_POOL_SIZE: '0',
          }),
        ),
        RuntimeRole.Api,
      ),
    ).toThrow(ConfigValidationError);
  });

  it('rejects partial S3 configuration', () => {
    expect(() =>
      loadAndValidateConfig(
        createSecrets(
          apiSecrets({
            S3_ENDPOINT: 'http://localhost:9000',
          }),
        ),
        RuntimeRole.Api,
      ),
    ).toThrow(ConfigValidationError);
  });

  it('parses feature flags from FEATURE_ variables', () => {
    const flags = parseFeatureFlags(
      createSecrets({
        FEATURE_RESEARCH_RUNS: 'true',
        FEATURE_BETA_UI: '0',
      }),
    );

    expect(flags).toEqual({
      research_runs: true,
      beta_ui: false,
    });
  });

  it('requires secrets through SecretsService', () => {
    expect(() => parseRequiredSecret(createSecrets({}), 'DATABASE_URL')).toThrow(
      ConfigValidationError,
    );
  });

  it('requires AUTH_JWT_PRIVATE_KEY and AUTH_JWT_KID for the API role', () => {
    expect(() =>
      loadAndValidateConfig(
        createSecrets({
          DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
          REDIS_URL: 'redis://localhost:6379',
        }),
        RuntimeRole.Api,
      ),
    ).toThrow(new ConfigValidationError('Missing required configuration: AUTH_JWT_PRIVATE_KEY'));

    expect(() =>
      loadAndValidateConfig(
        createSecrets({
          DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
          REDIS_URL: 'redis://localhost:6379',
          AUTH_JWT_PRIVATE_KEY: JWT.AUTH_JWT_PRIVATE_KEY,
        }),
        RuntimeRole.Api,
      ),
    ).toThrow(new ConfigValidationError('Missing required configuration: AUTH_JWT_KID'));
  });

  it('does not require JWT keys or a TOTP wrap key for the worker role', () => {
    const config = loadAndValidateConfig(
      createSecrets({
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
      }),
      RuntimeRole.Worker,
    );
    expect(config.jwt).toBeUndefined();
    expect(config.totpWrapKey).toBeUndefined();
  });

  it('loads jwt config on the API role', () => {
    const config = loadAndValidateConfig(createSecrets(apiSecrets()), RuntimeRole.Api);
    expect(config.jwt?.kid).toBe(JWT.AUTH_JWT_KID);
    expect(config.jwt?.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(config.loadedKeyNames).toEqual(
      expect.arrayContaining(['AUTH_JWT_PRIVATE_KEY', 'AUTH_JWT_KID', 'AUTH_TOTP_WRAP_KEY']),
    );
    expect(config.totpWrapKey).toHaveLength(32);
  });

  it('requires AUTH_TOTP_WRAP_KEY for the API role', () => {
    expect(() =>
      loadAndValidateConfig(
        createSecrets({
          DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
          REDIS_URL: 'redis://localhost:6379',
          AUTH_JWT_PRIVATE_KEY: JWT.AUTH_JWT_PRIVATE_KEY,
          AUTH_JWT_KID: JWT.AUTH_JWT_KID,
        }),
        RuntimeRole.Api,
      ),
    ).toThrow(new ConfigValidationError('Missing required configuration: AUTH_TOTP_WRAP_KEY'));
  });
});
