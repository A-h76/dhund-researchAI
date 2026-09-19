import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { AdapterInvokeOutcome } from '../../src/ai/adapters/adapter-outcome';
import type { AdapterInvokeInput, CapabilityAdapter } from '../../src/ai/adapters/adapter.port';
import { AdapterRegistry } from '../../src/ai/adapters/adapter-registry';
import { NoopDataBoundary } from '../../src/ai/boundary/noop-data-boundary';
import { GatewayService } from '../../src/ai/gateway/gateway.service';
import type { GatewayContext } from '../../src/ai/gateway/gateway.types';
import { computeInputFingerprint } from '../../src/ai/gateway/input-fingerprint';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import { PrismaAiExecutionLedgerAdapter } from '../../src/l0/adapters/prisma/prisma-ai-execution-ledger.adapter';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { PrismaResearchRunStoreAdapter } from '../../src/l0/adapters/prisma/prisma-research-run-store.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { OutboxWriterService } from '../../src/platform/events';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { RuntimeRole } from '../../src/platform/runtime/role';
import {
  isOverageWithinBound,
  measuredOverageMicros,
} from '../../src/orchestration/budget/research-run-budget';
import { ResearchRunCoordinationService } from '../../src/orchestration/research-run-coordination.service';
import { ResearchRunCoordinatorService } from '../../src/orchestration/research-run-coordinator.service';
import { ResearchRunMetrics } from '../../src/orchestration/research-run.metrics';
import { ResearchRunPlannerService } from '../../src/orchestration/research-run-planner.service';
import { ResearchRunTransitionService } from '../../src/orchestration/research-run-transition.service';
import type { PlatformLogger } from '../../src/platform/logging';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

class CostedChatAdapter implements CapabilityAdapter {
  readonly capability = 'CHAT' as const;

  constructor(private readonly costMicros: number) {}

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    return {
      status: 'ok',
      method: 'llm',
      result: {
        capability: 'CHAT',
        text: 'integration-response',
        inputFingerprint: computeInputFingerprint(input.request),
        promptVersion: input.policy.promptVersion,
        provider: input.policy.provider,
        model: input.policy.modelId,
        metrics: {
          latencyMs: 2,
          tokensIn: 3,
          tokensOut: 5,
          costMicros: this.costMicros,
        },
      },
      attempts: [
        {
          provider: input.policy.provider,
          model: input.policy.modelId,
          status: 'ok',
          latencyMs: 2,
          costMicros: this.costMicros,
        },
      ],
      tokensIn: 3,
      tokensOut: 5,
      costMicros: this.costMicros,
    };
  }
}

(integrationEnabled ? describe : describe.skip)(
  'DHB-66 ResearchRun budget (integration)',
  () => {
    jest.setTimeout(360_000);

    let prisma!: PrismaClient;
    let database!: PrismaDatabaseAdapter;
    let store!: PrismaResearchRunStoreAdapter;
    let coordinator!: ResearchRunCoordinatorService;
    let gateway!: GatewayService;
    let metrics!: ResearchRunMetrics;
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
      metrics = new ResearchRunMetrics(logger);
      const transitions = new ResearchRunTransitionService(
        store,
        writer,
        coordination,
        metrics,
      );
      const enqueue = { enqueue: jest.fn().mockResolvedValue('job-id') };
      const planner = new ResearchRunPlannerService(store, metrics);
      coordinator = new ResearchRunCoordinatorService(
        store,
        transitions,
        coordination,
        metrics,
        enqueue as never,
        planner,
      );

      const registry = AdapterRegistry.forAdapters([new CostedChatAdapter(100)]);
      gateway = new GatewayService(
        new NoopDataBoundary(),
        new PrismaAiExecutionLedgerAdapter(database),
        new PolicyResolver(),
        new PromptAssembler(),
        registry,
        logger,
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

    async function seedOrgProject(): Promise<{
      readonly userId: string;
      readonly orgId: string;
      readonly projectId: string;
    }> {
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
      return { userId, orgId, projectId };
    }

    async function seedRun(input: {
      readonly reservedMicros: bigint;
      readonly consumedMicros?: bigint;
    }): Promise<{
      readonly runId: string;
      readonly orgId: string;
      readonly projectId: string;
      readonly userId: string;
    }> {
      const { userId, orgId, projectId } = await seedOrgProject();
      const runId = generateId();
      await prisma.researchRun.create({
        data: {
          id: runId,
          orgId,
          projectId,
          initiatedBy: userId,
          preset: 'deep_research',
          reservedMicros: input.reservedMicros,
          consumedMicros: input.consumedMicros ?? 0n,
          state: 'RUNNING',
          idempotencyKey: `key-${runId}`,
        },
      });
      return { runId, orgId, projectId, userId };
    }

    function apiContext(
      orgId: string,
      projectId: string,
      researchRunId: string,
    ): GatewayContext {
      return {
        orgId,
        projectId,
        researchRunId,
        correlationId: `corr-${generateId()}`,
        runtimeRole: RuntimeRole.Api,
      };
    }

    it('pauses at dispatch, leaves in-flight running, and bounds overage', async () => {
      await runWithCorrelationIdAsync('corr-66-int-pause', async () => {
        const ceiling = 100n;
        coordinator.setPerStepCeilingMicros(ceiling);
        const { runId, orgId, projectId } = await seedRun({
          reservedMicros: 150n,
          consumedMicros: 150n,
        });

        const ready = generateId();
        const inflightA = generateId();
        const inflightB = generateId();
        await store.createSteps(runId, [
          {
            id: inflightA,
            stepType: 'retrieve',
            dependsOnStepIds: [],
            inputFingerprint: 'fp-inflight-a',
            stepVersion: 'v1',
            state: 'RUNNING',
          },
          {
            id: inflightB,
            stepType: 'retrieve',
            dependsOnStepIds: [],
            inputFingerprint: 'fp-inflight-b',
            stepVersion: 'v1',
            state: 'DISPATCHED',
          },
          {
            id: ready,
            stepType: 'retrieve',
            dependsOnStepIds: [],
            inputFingerprint: 'fp-ready',
            stepVersion: 'v1',
            state: 'READY',
          },
        ]);

        await coordinator.executeTick({ runId });
        const run = await store.getById(runId);
        expect(run?.state).toBe('PAUSED_BUDGET');

        const steps = await store.listSteps(runId);
        expect(steps.find((step) => step.id === inflightA)?.state).toBe('RUNNING');
        expect(steps.find((step) => step.id === inflightB)?.state).toBe('DISPATCHED');
        expect(steps.find((step) => step.id === ready)?.state).toBe('DEFERRED');

        // In-flight steps finish and debit up to the per-step ceiling.
        await gateway.execute(apiContext(orgId, projectId, runId), {
          capability: 'CHAT',
          userMessage: 'inflight-a',
        });
        await gateway.execute(apiContext(orgId, projectId, runId), {
          capability: 'CHAT',
          userMessage: 'inflight-b',
        });

        const after = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
        const overage = measuredOverageMicros(after.reservedMicros, after.consumedMicros);
        expect(overage).toBe(200n);
        expect(isOverageWithinBound(overage, 2, ceiling)).toBe(true);
        expect(metrics.snapshot().budgetPauseCount).toBeGreaterThanOrEqual(1);
      });
    });

    it('reconciles consumedMicros by re-SUM and leaves projection unchanged on rollback', async () => {
      await runWithCorrelationIdAsync('corr-66-int-reconcile', async () => {
        const { runId, orgId, projectId } = await seedRun({
          reservedMicros: 1_000_000n,
        });

        await gateway.execute(apiContext(orgId, projectId, runId), {
          capability: 'CHAT',
          userMessage: 'one',
        });
        await gateway.execute(apiContext(orgId, projectId, runId), {
          capability: 'CHAT',
          userMessage: 'two',
        });

        const aggregate = await prisma.aiExecution.aggregate({
          where: { researchRunId: runId },
          _sum: { costMicros: true },
        });
        const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId } });
        expect(run.consumedMicros).toBe(aggregate._sum.costMicros);
        expect(run.consumedMicros).toBe(200n);

        const before = run.consumedMicros;
        await expect(
          prisma.$transaction(async (tx) => {
            await tx.researchRun.update({
              where: { id: runId },
              data: { consumedMicros: { increment: 999n } },
            });
            throw new Error('force rollback');
          }),
        ).rejects.toThrow(/force rollback/);

        const afterRollback = await prisma.researchRun.findUniqueOrThrow({
          where: { id: runId },
        });
        expect(afterRollback.consumedMicros).toBe(before);
      });
    });

    it('resumes after budget increase without repeating succeeded work', async () => {
      await runWithCorrelationIdAsync('corr-66-int-resume', async () => {
        coordinator.setPerStepCeilingMicros(100n);
        const { runId } = await seedRun({
          reservedMicros: 100n,
          consumedMicros: 100n,
        });
        const done = generateId();
        const deferred = generateId();
        await store.createSteps(runId, [
          {
            id: done,
            stepType: 'retrieve',
            dependsOnStepIds: [],
            inputFingerprint: 'fp-done',
            stepVersion: 'v1',
            state: 'SUCCEEDED',
          },
          {
            id: deferred,
            stepType: 'retrieve',
            dependsOnStepIds: [],
            inputFingerprint: 'fp-next',
            stepVersion: 'v1',
            state: 'DEFERRED',
          },
        ]);
        await prisma.researchRun.update({
          where: { id: runId },
          data: { state: 'PAUSED_BUDGET', version: 1 },
        });

        const result = await coordinator.resumeAfterBudgetIncrease(runId, 200n);
        expect(result.kind).toBe('applied');
        const run = await store.getById(runId);
        expect(run?.state).toBe('RUNNING');
        expect(run?.reservedMicros).toBe(300n);
        expect(run?.consumedMicros).toBe(100n);

        expect((await store.getStep(done))?.state).toBe('SUCCEEDED');
        expect((await store.getStep(deferred))?.state).toBe('PENDING');

        await coordinator.executeTick({ runId });
        expect((await store.getStep(deferred))?.state).toBe('DISPATCHED');
        expect((await store.getStep(done))?.state).toBe('SUCCEEDED');
      });
    });
  },
);
