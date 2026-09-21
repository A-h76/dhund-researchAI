import { execSync } from 'node:child_process';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer } from 'testcontainers';
import { generateId } from '../../src/platform/ids';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaConnectorCacheAdapter } from '../../src/l0/adapters/prisma/prisma-connector-cache.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('DHB-70 GAP-CONN-CACHE-01 connector_cache survives Redis flush', () => {
  jest.setTimeout(180_000);

  it('keeps Postgres connector_cache entries after Redis FLUSHALL', async () => {
    const pg = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

    const databaseUrl = pg.getConnectionUri();
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    const redisUrl = `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`;
    const redisClient = new Redis(redisUrl);
    await redisClient.set('ephemeral:probe', '1');

    const config: L0ConnectionConfig = {
      databaseUrl,
      redisUrl,
      databasePoolSize: 5,
    };

    const database = new PrismaDatabaseAdapter(config);
    await database.connect();
    const cache = new PrismaConnectorCacheAdapter(database);

    const provider = 'arxiv';
    const cacheKey = `test-${generateId()}`;
    const value = { title: 'cached paper', externalId: '2301.00001' };
    await cache.set({
      provider,
      cacheKey,
      value,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await redisClient.flushall();
    expect(await redisClient.get('ephemeral:probe')).toBeNull();

    const entry = await cache.get(provider, cacheKey);
    expect(entry).not.toBeNull();
    expect(entry?.value).toEqual(value);

    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await expect(
      prisma.connectorCache.create({
        data: {
          id: generateId(),
          provider,
          cacheKey,
          value,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();

    await prisma.$disconnect();
    await database.disconnect();
    await redisClient.quit();
    await pg.stop();
    await redis.stop();
  });
});
