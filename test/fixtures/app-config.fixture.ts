import type { AppConfig } from '../../src/platform/config/app-config.types';
import { setAppConfig } from '../../src/platform/config/config.runtime';

export function buildTestAppConfig(
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return Object.freeze({
    port: 3000,
    logLevel: 'silent',
    databaseUrl: 'postgres://dhund:dhund@localhost:5432/dhund',
    redisUrl: 'redis://localhost:6379',
    embeddingDimension: 1536,
    featureFlags: Object.freeze({ research_runs: false }),
    loadedKeyNames: Object.freeze([
      'DATABASE_URL',
      'EMBEDDING_DIMENSION',
      'REDIS_URL',
    ]),
    ...overrides,
  });
}

export function installTestAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const config = buildTestAppConfig(overrides);
  setAppConfig(config);
  return config;
}
