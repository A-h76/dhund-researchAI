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
import { ResearchRunCoordinatorService } from '../../src/orchestration/research-run-coordinator.service';
import { ResearchRunMetrics } from '../../src/orchestration/research-run.metrics';
import { ResearchRunPlannerService } from '../../src/orchestration/research-run-planner.service';
import { ResearchRunTransitionService } from '../../src/orchestration/research-run-transition.service';
import { ResearchRunStepExecutor } from '../../src/apps/worker/research-run-step.executor';
import { DEEP_RESEARCH_QUERY } from '../../src/orchestration/presets/builtin-presets';
import type { PlatformLogger } from '../../src/platform/logging';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)(
  'DHB-65 research-run-step dispatch (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma!: PrismaClient;
    let database!: PrismaDatabaseAdapter;
    let store!: PrismaResearchRunStoreAdapter;
    let coordinator!: ResearchRunCoordinatorService;
    let enqueue!: { enqueue: jest.Mock };
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
      const writer = new OutboxWriterService(new PrismaOutboxAdapter(database));
      const coordination = new ResearchRunCoordinationService();
      const metrics = new ResearchRunMetrics(logger);
      const transitions = new ResearchRunTransitionService(
        store,
        writer,
        coordination,
        metrics,
      );
      enqueue = { enqueue: jest.fn().mockResolvedValue('job-id') };
      const planner = new ResearchRunPlannerService(store, metrics);
      coordinator = new ResearchRunCoordinatorService(
        store,
        transitions,
        coordination,
        metrics,
        enqueue as never,
        planner,
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

    async function seedRun(input?: {
      readonly preset?: 'deep_research' | 'custom';
      readonly customDag?: object | null;
    }): Promise<{ readonly runId: string; readonly orgId: string; readonly projectId: string }> {
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
          preset: input?.preset ?? 'deep_research',
          customDag: input?.customDag === undefined ? undefined : (input.customDag as never),
          reservedMicros: 1000n,
          idempotencyKey: `key-${runId}`,
        },
      });
      return { runId, orgId, projectId };
    }

    it('respects step dependency ordering and duplicate-step dedupe', async () => {
      await runWithCorrelationIdAsync('corr-int-deps', async () => {
        const { runId } = await seedRun();
        await coordinator.executeTick({ runId });
        expect((await store.getById(runId))?.state).toBe('PLANNING');

        enqueue.enqueue.mockClear();
        await coordinator.executeTick({ runId });
        expect((await store.getById(runId))?.state).toBe('RUNNING');
        await coordinator.executeTick({ runId });
        const first = await prisma.researchRunStep.findMany({ where: { runId } });
        expect(first).toHaveLength(2);
        const retrieve = first.find((step) => step.stepType === 'retrieve');
        const admit = first.find((step) => step.stepType === 'admit');
        expect(retrieve?.state).toBe('DISPATCHED');
        expect(admit?.state).toBe('PENDING');
        expect(enqueue.enqueue).toHaveBeenCalledTimes(1);

        await coordinator.executeTick({ runId });
        expect(enqueue.enqueue).toHaveBeenCalledTimes(1);

        expect(retrieve).toBeDefined();
        if (retrieve === undefined) {
          return;
        }
        await store.transitionStep({
          stepId: retrieve.id,
          fromState: 'DISPATCHED',
          toState: 'RUNNING',
          expectedVersion: retrieve.version,
        });
        const running = await store.getStep(retrieve.id);
        expect(running).not.toBeNull();
        if (running === null) {
          return;
        }
        await store.transitionStep({
          stepId: running.id,
          fromState: 'RUNNING',
          toState: 'SUCCEEDED',
          expectedVersion: running.version,
        });

        enqueue.enqueue.mockClear();
        await coordinator.executeTick({ runId });
        const after = await prisma.researchRunStep.findUniqueOrThrow({
          where: { id: admit?.id ?? '' },
        });
        expect(after.state).toBe('DISPATCHED');
        expect(enqueue.enqueue).toHaveBeenCalledTimes(1);
      });
    });

    it('persists a custom DAG on the run and does not fail the run on step failure', async () => {
      await runWithCorrelationIdAsync('corr-int-custom', async () => {
        const customDag = {
          schemaVersion: 1,
          presetCode: 'custom',
          nodes: [
            { key: 'retrieve', stepType: 'retrieve', dependsOn: [], query: 'q' },
            { key: 'admit', stepType: 'admit', dependsOn: ['retrieve'] },
          ],
        };
        const { runId } = await seedRun({ preset: 'custom', customDag });
        const loaded = await store.getById(runId);
        expect(loaded?.preset).toBe('custom');
        expect(loaded?.customDag).toMatchObject(customDag);

        await coordinator.executeTick({ runId });
        await coordinator.executeTick({ runId });
        await coordinator.executeTick({ runId });
        const retrieve = await prisma.researchRunStep.findFirstOrThrow({
          where: { runId, stepType: 'retrieve' },
        });
        await store.transitionStep({
          stepId: retrieve.id,
          fromState: 'DISPATCHED',
          toState: 'FAILED',
          expectedVersion: retrieve.version,
        });
        await coordinator.executeTick({ runId });
        expect((await store.getById(runId))?.state).toBe('COMPLETING');
        await coordinator.executeTick({ runId });
        expect((await store.getById(runId))?.state).toBe('COMPLETED_PARTIAL');
      });
    });

    it('retrieval provenance writes fingerprint and durable trace ref', async () => {
      await runWithCorrelationIdAsync('corr-int-retr', async () => {
        const { runId, orgId, projectId } = await seedRun();
        const stepId = generateId();
        await store.createSteps(runId, [
          {
            id: stepId,
            stepType: 'retrieve',
            dependsOnStepIds: [],
            inputFingerprint: 'plan-fp',
            stepVersion: 'v1',
            state: 'DISPATCHED',
          },
        ]);

        const retrieval = {
          retrieve: jest.fn().mockResolvedValue({
            trace: { id: 'trace-int-1', fingerprint: 'fp-int-1' },
          }),
        };
        const extract = { execute: jest.fn() };
        const writer = new OutboxWriterService(new PrismaOutboxAdapter(database));
        const executor = new ResearchRunStepExecutor(
          store,
          retrieval as never,
          enqueue as never,
          extract as never,
          writer,
          new ResearchRunMetrics(logger),
        );

        await executor.execute({
          orgId,
          projectId,
          runId,
          stepId,
          stepType: 'retrieve',
          inputFingerprint: 'plan-fp',
          stepVersion: 'v1',
          correlationId: 'corr-int-retr',
          query: DEEP_RESEARCH_QUERY,
        });

        const step = await prisma.researchRunStep.findUniqueOrThrow({ where: { id: stepId } });
        expect(step.state).toBe('SUCCEEDED');
        expect(step.inputFingerprint).toBe('fp-int-1');
        expect(step.resultRef).toBe('trace-int-1');
        expect(retrieval.retrieve).toHaveBeenCalled();
      });
    });
  },
);
