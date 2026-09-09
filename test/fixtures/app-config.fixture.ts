import type { AppConfig } from '../../src/platform/config/app-config.types';
import { setAppConfig } from '../../src/platform/config/config.runtime';
import { generateTestJwtConfig } from './jwt-keys.fixture';

const TEST_JWT = generateTestJwtConfig();

export function buildTestAppConfig(
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return Object.freeze({
    port: 3000,
    logLevel: 'silent',
    databaseUrl: 'postgres://dhund:dhund@localhost:5432/dhund',
    databasePoolSize: 10,
    redisUrl: 'redis://localhost:6379',
    featureFlags: Object.freeze({ research_runs: false }),
    argon2: Object.freeze({
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    }),
    jwt: TEST_JWT,
    loadedKeyNames: Object.freeze([
      'AUTH_JWT_KID',
      'AUTH_JWT_PRIVATE_KEY',
      'DATABASE_URL',
      'DATABASE_POOL_SIZE',
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
