import { emptyResearchRunCoverage } from '../../src/l0/ports/research-run-coverage';
import { OutboxWriterService } from '../../src/platform/events';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { RESEARCH_RUN_PER_STEP_CEILING_MICROS } from '../../src/orchestration/budget/research-run-budget';
import { ResearchRunCoordinationService } from '../../src/orchestration/research-run-coordination.service';
import { ResearchRunCoordinatorService } from '../../src/orchestration/research-run-coordinator.service';
import { ResearchRunMetrics } from '../../src/orchestration/research-run.metrics';
import { ResearchRunPlannerService } from '../../src/orchestration/research-run-planner.service';
import { ResearchRunTransitionService } from '../../src/orchestration/research-run-transition.service';
import { MemoryResearchRunStore } from '../fixtures/memory-research-run-store';
import type { PlatformLogger } from '../../src/platform/logging';
import {
  isOverageWithinBound,
  measuredOverageMicros,
} from '../../src/orchestration/budget/research-run-budget';

function createHarness(store = new MemoryResearchRunStore()) {
  const outboxPort = {
    withTransaction: async <T>(work: (tx: unknown) => Promise<T>) =>
      work({ __brand: 'OutboxTransaction' }),
    append: async () => undefined,
    appendStateMarker: async () => undefined,
    listUnrelayedOrdered: async () => [],
    markRelayed: async () => undefined,
    incrementAttempt: async () => undefined,
    countUnrelayed: async () => 0,
    oldestUnrelayedCreatedAt: async () => null,
  };
  const writer = new OutboxWriterService(outboxPort as never);
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  } as unknown as PlatformLogger;
  const metrics = new ResearchRunMetrics(logger);
  const coordination = new ResearchRunCoordinationService();
  const transitions = new ResearchRunTransitionService(
    store,
    writer,
    coordination,
    metrics,
  );
  const enqueue = {
    enqueue: jest.fn().mockResolvedValue('job-id'),
  };
  const planner = new ResearchRunPlannerService(store, metrics);
  const coordinator = new ResearchRunCoordinatorService(
    store,
    transitions,
    coordination,
    metrics,
    enqueue as never,
    planner,
  );
  return { store, writer, metrics, coordination, transitions, coordinator, enqueue };
}

describe('ResearchRun budget enforcement (DHB-66)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';
  const ceiling = 100n;

  it('evaluates the cap only at dispatch and soft-reserves per ready step', async () => {
    await runWithCorrelationIdAsync('corr-66-dispatch', async () => {
      const { store, coordinator, enqueue } = createHarness();
      coordinator.setPerStepCeilingMicros(ceiling);
      store.seed({
        id: 'run-budget-dispatch',
        orgId,
        projectId,
        state: 'RUNNING',
        reservedMicros: 250n,
        consumedMicros: 0n,
      });
      await store.createSteps('run-budget-dispatch', [
        {
          id: '11111111-1111-4111-8111-111111111101',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-a',
          stepVersion: 'v1',
          state: 'READY',
        },
        {
          id: '11111111-1111-4111-8111-111111111102',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-b',
          stepVersion: 'v1',
          state: 'READY',
        },
        {
          id: '11111111-1111-4111-8111-111111111103',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-c',
          stepVersion: 'v1',
          state: 'READY',
        },
      ]);

      const outcome = await coordinator.executeTick({ runId: 'run-budget-dispatch' });
      expect(outcome.kind).toBe('transitioned');
      if (outcome.kind === 'transitioned') {
        expect(outcome.toState).toBe('PAUSED_BUDGET');
      }

      const steps = await store.listSteps('run-budget-dispatch');
      const dispatched = steps.filter((step) => step.state === 'DISPATCHED');
      const deferred = steps.filter((step) => step.state === 'DEFERRED');
      expect(dispatched).toHaveLength(2);
      expect(deferred).toHaveLength(1);
      expect(enqueue.enqueue).toHaveBeenCalledTimes(2);
      expect((await store.getById('run-budget-dispatch'))?.state).toBe('PAUSED_BUDGET');
    });
  });

  it('never kills in-flight steps when pausing for budget', async () => {
    await runWithCorrelationIdAsync('corr-66-inflight', async () => {
      const { store, coordinator } = createHarness();
      coordinator.setPerStepCeilingMicros(ceiling);
      store.seed({
        id: 'run-inflight',
        orgId,
        projectId,
        state: 'RUNNING',
        reservedMicros: 100n,
        consumedMicros: 100n,
      });
      await store.createSteps('run-inflight', [
        {
          id: '11111111-1111-4111-8111-111111111201',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-in',
          stepVersion: 'v1',
          state: 'RUNNING',
        },
        {
          id: '11111111-1111-4111-8111-111111111202',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-ready',
          stepVersion: 'v1',
          state: 'READY',
        },
      ]);

      await coordinator.executeTick({ runId: 'run-inflight' });
      const steps = await store.listSteps('run-inflight');
      expect(steps.find((step) => step.id.endsWith('1201'))?.state).toBe('RUNNING');
      expect(steps.find((step) => step.id.endsWith('1202'))?.state).toBe('DEFERRED');
      expect((await store.getById('run-inflight'))?.state).toBe('PAUSED_BUDGET');
    });
  });

  it('bounds overage by in-flight concurrency × per-step ceiling', async () => {
    await runWithCorrelationIdAsync('corr-66-overage', async () => {
      const { store, coordinator, metrics } = createHarness();
      coordinator.setPerStepCeilingMicros(ceiling);
      store.seed({
        id: 'run-overage',
        orgId,
        projectId,
        state: 'RUNNING',
        reservedMicros: 100n,
        consumedMicros: 100n,
      });
      await store.createSteps('run-overage', [
        {
          id: '11111111-1111-4111-8111-111111111301',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-1',
          stepVersion: 'v1',
          state: 'RUNNING',
        },
        {
          id: '11111111-1111-4111-8111-111111111302',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-2',
          stepVersion: 'v1',
          state: 'DISPATCHED',
        },
        {
          id: '11111111-1111-4111-8111-111111111303',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-ready',
          stepVersion: 'v1',
          state: 'READY',
        },
      ]);

      await coordinator.executeTick({ runId: 'run-overage' });
      expect((await store.getById('run-overage'))?.state).toBe('PAUSED_BUDGET');

      // In-flight steps finish and debit up to the per-step ceiling each.
      store.debitConsumed('run-overage', ceiling);
      store.debitConsumed('run-overage', ceiling);
      const run = await store.getById('run-overage');
      expect(run).not.toBeNull();
      if (run === null) {
        return;
      }
      const overage = measuredOverageMicros(run.reservedMicros, run.consumedMicros);
      expect(overage).toBe(200n);
      expect(isOverageWithinBound(overage, 2, ceiling)).toBe(true);
      expect(metrics.snapshot().budgetPauseCount).toBe(1);
      expect(metrics.snapshot().lastOverageMicros).toBe(0n);
    });
  });

  it('resumes after budget increase without repeating work or double-charging', async () => {
    await runWithCorrelationIdAsync('corr-66-resume', async () => {
      const { store, coordinator, enqueue, metrics } = createHarness();
      coordinator.setPerStepCeilingMicros(ceiling);
      store.seed({
        id: 'run-resume',
        orgId,
        projectId,
        state: 'PAUSED_BUDGET',
        reservedMicros: 100n,
        consumedMicros: 100n,
        version: 3,
      });
      await store.createSteps('run-resume', [
        {
          id: '11111111-1111-4111-8111-111111111401',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-done',
          stepVersion: 'v1',
          state: 'SUCCEEDED',
        },
        {
          id: '11111111-1111-4111-8111-111111111402',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp-deferred',
          stepVersion: 'v1',
          state: 'DEFERRED',
        },
      ]);

      coordinator.resetAppliedChargeCount();
      enqueue.enqueue.mockClear();
      const result = await coordinator.resumeAfterBudgetIncrease('run-resume', 200n);
      expect(result.kind).toBe('applied');
      const run = await store.getById('run-resume');
      expect(run?.state).toBe('RUNNING');
      expect(run?.reservedMicros).toBe(300n);
      expect(run?.consumedMicros).toBe(100n);

      const succeeded = (await store.listSteps('run-resume')).find((step) =>
        step.id.endsWith('1401'),
      );
      expect(succeeded?.state).toBe('SUCCEEDED');

      await coordinator.executeTick({ runId: 'run-resume' });
      const steps = await store.listSteps('run-resume');
      expect(steps.find((step) => step.id.endsWith('1402'))?.state).toBe('DISPATCHED');
      expect(enqueue.enqueue).toHaveBeenCalled();
      expect(metrics.snapshot().budgetIncreaseCount).toBe(1);
      expect(coordinator.getAppliedChargeCount()).toBeGreaterThanOrEqual(1);
    });
  });

  it('keeps default per-step ceiling as integer micros', () => {
    expect(typeof RESEARCH_RUN_PER_STEP_CEILING_MICROS).toBe('bigint');
    expect(RESEARCH_RUN_PER_STEP_CEILING_MICROS).toBeGreaterThan(0n);
  });

  it('pauses on budget boundary when ready steps remain (count-only path)', async () => {
    await runWithCorrelationIdAsync('corr-66-counts', async () => {
      const { store, coordinator } = createHarness();
      store.seed({
        id: 'run-budget-counts',
        orgId,
        projectId,
        state: 'RUNNING',
        reservedMicros: 100n,
        consumedMicros: 100n,
        coverage: emptyResearchRunCoverage(),
      });
      store.setStepCounts('run-budget-counts', { ready: 2, inFlight: 0, pending: 0 });
      await coordinator.executeTick({ runId: 'run-budget-counts' });
      expect((await store.getById('run-budget-counts'))?.state).toBe('PAUSED_BUDGET');
    });
  });
});
