import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import Redis from 'ioredis';
import { GenericContainer, Wait } from 'testcontainers';
import { AccessContextMetrics } from '../../src/iam/authorization/access-context.metrics';
import { AccessContextService } from '../../src/iam/authorization/access-context.service';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaTenancyAdapter } from '../../src/l0/adapters/prisma/prisma-tenancy.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { RedisAccessContextInvalidator } from '../../src/l0/adapters/redis/redis-access-context-invalidator';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { PlatformLogger } from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'DHB-37 AccessContext Redis (integration)',
  () => {
    jest.setTimeout(360_000);

    it('invalidates on DEL and rebuilds from Postgres after Redis flush', async () => {
      const postgres = await new PostgreSqlContainer(
        'pgvector/pgvector:pg16',
      ).start();
      const redisContainer = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
        .start();

      const databaseUrl = postgres.getConnectionUri();
      const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
      execSync('npx prisma migrate deploy', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });

      const prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });
      await prisma.$connect();

      const connectionConfig: L0ConnectionConfig = {
        databaseUrl,
        redisUrl,
        databasePoolSize: 5,
      };
      const database = new PrismaDatabaseAdapter(connectionConfig);
      await database.connect();
      const tenancy = new PrismaTenancyAdapter(database);
      const cache = new RedisCacheAdapter(connectionConfig);
      await cache.connect();
      const metrics = new AccessContextMetrics({
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      } as unknown as PlatformLogger);
      const service = new AccessContextService(tenancy, cache, metrics);
      const invalidator = new RedisAccessContextInvalidator(cache);

      const userId = generateId();
      const orgId = generateId();
      const projectId = generateId();
      await prisma.user.create({
        data: {
          id: userId,
          displayName: 'Pat',
          email: `pat-${userId}@example.com`,
        },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'Acme' },
      });
      await prisma.orgMembership.create({
        data: {
          id: generateId(),
          orgId,
          userId,
          role: 'MEMBER',
        },
      });
      await prisma.project.create({
        data: { id: projectId, orgId, name: 'Atlas', settings: {} },
      });
      await prisma.projectMembership.create({
        data: {
          id: generateId(),
          projectId,
          userId,
          role: 'VIEWER',
        },
      });

      const first = await service.resolve(userId);
      expect(first.projects).toEqual([
        { projectId, orgId, role: 'VIEWER' },
      ]);
      expect(metrics.snapshot().cacheMiss).toBe(1);

      const second = await service.resolve(userId);
      expect(second).toEqual(first);
      expect(metrics.snapshot().cacheHit).toBe(1);

      await invalidator.invalidateAccessContext(userId);
      await service.resolve(userId);
      expect(metrics.snapshot().cacheMiss).toBe(2);

      const raw = new Redis(redisUrl);
      await raw.flushall();
      await raw.quit();
      await service.resolve(userId);
      expect(metrics.snapshot().cacheMiss).toBe(3);

      await cache.disconnect();
      await database.disconnect();
      await prisma.$disconnect();
      await redisContainer.stop();
      await postgres.stop();
    });
  },
);
