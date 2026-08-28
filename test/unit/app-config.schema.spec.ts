import type { SecretsService } from '../../src/l0/ports/secrets.port';
import { RuntimeRole } from '../../src/platform/runtime/role';
import {
  ConfigValidationError,
  loadAndValidateConfig,
  parseEmbeddingDimension,
  parseFeatureFlags,
  parseLogLevel,
  parsePort,
  parseRequiredSecret,
} from '../../src/platform/config';

function createSecrets(values: Record<string, string | undefined>): SecretsService {
  return {
    getSecret: (name: string) => values[name],
    listSecretKeys: () => Object.keys(values),
  };
}

describe('app config schema', () => {
  it('accepts a valid configuration', () => {
    const config = loadAndValidateConfig(
      createSecrets({
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        PORT: '3000',
        LOG_LEVEL: 'info',
        EMBEDDING_DIMENSION: '1536',
        FEATURE_RESEARCH_RUNS: 'false',
      }),
      RuntimeRole.Api,
    );

    expect(config.databaseUrl).toContain('postgres://');
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.embeddingDimension).toBe(1536);
    expect(config.featureFlags.research_runs).toBe(false);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() =>
      loadAndValidateConfig(
        createSecrets({ REDIS_URL: 'redis://localhost:6379' }),
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

  it('rejects an invalid EMBEDDING_DIMENSION', () => {
    expect(() => parseEmbeddingDimension('0')).toThrow(ConfigValidationError);
  });

  it('rejects partial S3 configuration', () => {
    expect(() =>
      loadAndValidateConfig(
        createSecrets({
          DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
          REDIS_URL: 'redis://localhost:6379',
          S3_ENDPOINT: 'http://localhost:9000',
        }),
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
});
