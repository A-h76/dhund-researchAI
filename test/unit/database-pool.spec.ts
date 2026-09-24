import {
  DEFAULT_DATABASE_POOL_SIZE,
  parseDatabasePoolSize,
  ConfigValidationError,
} from '../../src/platform/config';
import {
  readPrismaPoolSize,
  withPrismaPoolSize,
} from '../../src/l0/adapters/prisma/prisma-pool-url';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import type { SecretsService } from '../../src/l0/ports/secrets.port';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { loadAndValidateConfig } from '../../src/platform/config';
import { jwtSecretRecord } from '../fixtures/jwt-keys.fixture';
import { generateTestTotpWrapKey } from '../fixtures/totp-wrap.fixture';

function createSecrets(values: Record<string, string | undefined>): SecretsService {
  return {
    getSecret: (name: string) => values[name],
    listSecretKeys: () => Object.keys(values),
  };
}

describe('database pool configuration (DHB-28)', () => {
  it('defaults DATABASE_POOL_SIZE to the approved bound', () => {
    expect(parseDatabasePoolSize(undefined)).toBe(DEFAULT_DATABASE_POOL_SIZE);
  });

  it('rejects out-of-range pool sizes', () => {
    expect(() => parseDatabasePoolSize('0')).toThrow(ConfigValidationError);
    expect(() => parseDatabasePoolSize('101')).toThrow(ConfigValidationError);
    expect(() => parseDatabasePoolSize('1.5')).toThrow(ConfigValidationError);
  });

  it('loads pool size through AppConfig / SecretsService', () => {
    const config = loadAndValidateConfig(
      createSecrets({
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        DATABASE_POOL_SIZE: '25',
        ...jwtSecretRecord(),
        AUTH_TOTP_WRAP_KEY: generateTestTotpWrapKey(),
      }),
      RuntimeRole.Api,
    );

    expect(config.databasePoolSize).toBe(25);
  });

  it('applies connection_limit to the Prisma datasource URL', () => {
    const url = withPrismaPoolSize('postgres://user:pass@localhost:5432/db', 12);
    expect(readPrismaPoolSize(url)).toBe(12);
  });

  it('exposes configured pool size from the Prisma adapter', () => {
    const adapter = new PrismaDatabaseAdapter({
      databaseUrl: 'postgres://user:pass@localhost:5432/db',
      redisUrl: 'redis://localhost:6379',
      databasePoolSize: 7,
    });

    expect(adapter.getPoolInfo()).toEqual({ configuredSize: 7, inUse: 0 });
  });
});
