import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaBillingAdapter } from '../../src/l0/adapters/prisma/prisma-billing.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { RedisLeaseAdapter } from '../../src/l0/adapters/redis/redis-lease.adapter';
import type { BillingStore } from '../../src/l0/ports/billing.port';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { BillingMetrics } from '../../src/billing/billing.metrics';
import { BillingReconcileCoordination } from '../../src/billing/billing-reconcile.coordination';
import { BillingReconcileService } from '../../src/billing/billing-reconcile.service';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)('DHB-73 billing (integration)', () => {
  jest.setTimeout(360_000);

  it('rolls usage up once for the same org, period, and metric', async () => {
    const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const databaseUrl = postgres.getConnectionUri();
    execSync('npx prisma migrate deploy', {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const connectionConfig: L0ConnectionConfig = {
      databaseUrl,
      redisUrl: 'redis://127.0.0.1:6379',
      databasePoolSize: 2,
    };
    const database = new PrismaDatabaseAdapter(connectionConfig);
    const billing = new PrismaBillingAdapter(database);
    try {
      const orgId = generateId();
      await prisma.organization.create({
        data: { id: orgId, kind: 'TEAM', name: 'DHB-73' },
      });
      const periodStart = new Date('2026-09-01T00:00:00.000Z');
      const periodEnd = new Date('2026-10-01T00:00:00.000Z');
      const period = `${periodStart.toISOString()}/${periodEnd.toISOString()}`;
      const input = {
        orgId,
        period,
        periodStart,
        periodEnd,
        metric: 'documents' as const,
      };
      const first = await billing.rollupUsage({ ...input, id: generateId(), value: 4n });
      const second = await billing.rollupUsage({ ...input, id: generateId(), value: 4n });
      const zero = await billing.rollupUsage({ ...input, id: generateId(), value: 0n });
      expect(first.value).toBe(4n);
      expect(second.value).toBe(4n);
      expect(zero.value).toBe(4n);
      expect(await prisma.usageCounter.count({ where: { orgId, period, metric: 'documents' } })).toBe(1);
    } finally {
      await prisma.$disconnect();
      await database.disconnect();
      await postgres.stop();
    }
  });

  it('lets only one worker claim a reconcile tick', async () => {
    const redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();
    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgresql://unused',
      redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      databasePoolSize: 1,
    };
    const lease = new RedisLeaseAdapter(connectionConfig);
    const store = {
      countReconciliationDrift: async () => 0,
    } as unknown as BillingStore;
    try {
      await lease.connect('dhb73');
      const first = new BillingReconcileService(
        new BillingReconcileCoordination(lease),
        store,
        new BillingMetrics(),
      );
      const second = new BillingReconcileService(
        new BillingReconcileCoordination(lease),
        store,
        new BillingMetrics(),
      );
      await expect(first.executeTick('2026-09-23', 'worker-a')).resolves.toBe('claimed');
      await expect(second.executeTick('2026-09-23', 'worker-b')).resolves.toBe('noop');
    } finally {
      await lease.disconnect();
      await redis.stop();
    }
  });
});
