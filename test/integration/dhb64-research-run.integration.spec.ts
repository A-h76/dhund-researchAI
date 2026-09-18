import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { PrismaResearchRunStoreAdapter } from '../../src/l0/adapters/prisma/prisma-research-run-store.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { OutboxWriterService } from '../../src/platform/events';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { ResearchRunCoordinationService } from '../../src/orchestration/research-run-coordination.service';
import { ResearchRunMetrics } from '../../src/orchestration/research-run.metrics';
import { ResearchRunTransitionService } from '../../src/orchestration/research-run-transition.service';
import type { PlatformLogger } from '../../src/platform/logging';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'DHB-64 research-run transitions + outbox (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma!: PrismaClient;
    let database!: PrismaDatabaseAdapter;
    let store!: PrismaResearchRunStoreAdapter;
    let transitions!: ResearchRunTransitionService;
    let stop: (() => Promise<void>) | undefined;

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as PlatformLogger;

    beforeAll(async () => {
      const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
      const databaseUrl = postgres.getConnectionUri();

      execSync('npx prisma migrate deploy', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });

      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      await prisma.$connect();

      const connectionConfig: L0ConnectionConfig = {
        databaseUrl,
        redisUrl: 'redis://127.0.0.1:6379',
        databasePoolSize: 5,
      };
      database = new PrismaDatabaseAdapter(connectionConfig);
      await database.connect();
      store = new PrismaResearchRunStoreAdapter(database);
      const outbox = new PrismaOutboxAdapter(database);
      const writer = new OutboxWriterService(outbox);
      const coordination = new ResearchRunCoordinationService();
      coordination.setAdvisoryLocksEnabled(true);
      transitions = new ResearchRunTransitionService(
        store,
        writer,
        coordination,
        new ResearchRunMetrics(logger),
      );

      stop = async () => {
        await database.disconnect();
        await prisma.$disconnect();
        await postgres.stop();
      };
    });

    afterAll(async () => {
      await stop?.();
    });

    async function seedRun(): Promise<string> {
      const orgId = generateId();
      const userId = generateId();
      const projectId = generateId();
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@example.com`,
          displayName: 'Test User',
        },
      });
      await prisma.organization.create({
        data: { id: orgId, kind: 'PERSONAL', name: 'Personal', ownerUserId: userId },
      });
      await prisma.project.create({
        data: { id: projectId, orgId, name: 'Project' },
      });
      const runId = generateId();
      await prisma.researchRun.create({
        data: {
          id: runId,
          orgId,
          projectId,
          initiatedBy: userId,
          preset: 'deep_research',
          reservedMicros: 1000n,
          idempotencyKey: `key-${runId}`,
        },
      });
      return runId;
    }

    it('commits lifecycle outbox events in the same transaction as the state change', async () => {
      await runWithCorrelationIdAsync('corr-int-1', async () => {
        const runId = await seedRun();

        const result = await transitions.transition({
          runId,
          toState: 'PLANNING',
        });
        expect(result.kind).toBe('applied');
        if (result.kind !== 'applied') {
          return;
        }

        const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
        expect(run.state).toBe('PLANNING');
        expect(run.version).toBe(1);

        const events = await prisma.outbox.findMany({
          where: { aggregateId: runId },
          orderBy: { createdAt: 'asc' },
        });
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events.some((e) => e.eventType === 'orchestration.research_run.state_changed')).toBe(
          true,
        );
        expect(result.outboxEventIds).toEqual(events.map((e) => e.id));
      });
    });

    it('rolls back outbox when the version guard misses (no partial commit)', async () => {
      await runWithCorrelationIdAsync('corr-int-2', async () => {
        const runId = await seedRun();
        const first = await transitions.transition({ runId, toState: 'PLANNING' });
        expect(first.kind).toBe('applied');

        const conflict = await transitions.transition({
          runId,
          toState: 'RUNNING',
          expectedVersion: 0,
        });
        expect(conflict.kind).toBe('version_conflict');

        const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
        expect(run.state).toBe('PLANNING');
        expect(run.version).toBe(1);

        const startedEvents = await prisma.outbox.count({
          where: {
            aggregateId: runId,
            eventType: 'orchestration.research_run.started',
          },
        });
        expect(startedEvents).toBe(0);
      });
    });

    it('two racing transitions with lock disabled still produce one outcome', async () => {
      await runWithCorrelationIdAsync('corr-int-3', async () => {
        const runId = await seedRun();
        const coordination = new ResearchRunCoordinationService();
        coordination.setAdvisoryLocksEnabled(false);
        const writer = new OutboxWriterService(new PrismaOutboxAdapter(database));
        const metrics = new ResearchRunMetrics(logger);
        const t = new ResearchRunTransitionService(store, writer, coordination, metrics);

        const [a, b] = await Promise.all([
          t.transition({ runId, toState: 'PLANNING', expectedVersion: 0 }),
          t.transition({ runId, toState: 'PLANNING', expectedVersion: 0 }),
        ]);

        const applied = [a, b].filter((r) => r.kind === 'applied');
        const conflicts = [a, b].filter((r) => r.kind === 'version_conflict');
        expect(applied).toHaveLength(1);
        expect(conflicts).toHaveLength(1);

        const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
        expect(run.state).toBe('PLANNING');
        expect(run.version).toBe(1);

        const stateChanged = await prisma.outbox.count({
          where: {
            aggregateId: runId,
            eventType: 'orchestration.research_run.state_changed',
          },
        });
        expect(stateChanged).toBe(1);
      });
    });
  },
);
