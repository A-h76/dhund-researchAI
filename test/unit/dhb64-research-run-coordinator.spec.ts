import { RESEARCH_RUN_STORE } from '../../src/l0/ports/tokens';
import { emptyResearchRunCoverage } from '../../src/l0/ports/research-run-coverage';
import { OutboxWriterService } from '../../src/platform/events';
import { DomainError, ErrorCode } from '../../src/platform/errors';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { ResearchRunCoordinationService } from '../../src/orchestration/research-run-coordination.service';
import { ResearchRunCoordinatorService } from '../../src/orchestration/research-run-coordinator.service';
import { ResearchRunMetrics } from '../../src/orchestration/research-run.metrics';
import { ResearchRunTransitionService } from '../../src/orchestration/research-run-transition.service';
import { MemoryResearchRunStore } from '../fixtures/memory-research-run-store';
import type { PlatformLogger } from '../../src/platform/logging';

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
  const planner = {
    plan: async () => ({ kind: 'ready' as const }),
  };
  const coordinator = new ResearchRunCoordinatorService(
    store,
    transitions,
    coordination,
    metrics,
    enqueue as never,
    planner as never,
  );
  return { store, writer, metrics, coordination, transitions, coordinator, enqueue };
}

describe('ResearchRun coordinator (DHB-64)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';

  it('drives CREATED → PLANNING → RUNNING on successive ticks', async () => {
    await runWithCorrelationIdAsync('corr-1', async () => {
      const { store, coordinator } = createHarness();
      const run = store.seed({ id: 'run-1', orgId, projectId });

      const first = await coordinator.executeTick({ runId: run.id });
      expect(first.kind).toBe('transitioned');
      expect((await store.getById(run.id))?.state).toBe('PLANNING');

      const second = await coordinator.executeTick({ runId: run.id });
      expect(second.kind).toBe('transitioned');
      expect((await store.getById(run.id))?.state).toBe('RUNNING');
    });
  });

  it('FAILED occurs only on planning failure or zero eligible sources', async () => {
    await runWithCorrelationIdAsync('corr-fail', async () => {
      const { store, coordinator, transitions } = createHarness();
      store.seed({ id: 'run-fail-plan', orgId, projectId, state: 'PLANNING' });
      coordinator.setPlanningHook(() => ({
        kind: 'failed',
        reason: 'planning_failure',
      }));
      await coordinator.executeTick({ runId: 'run-fail-plan' });
      expect((await store.getById('run-fail-plan'))?.state).toBe('FAILED');

      store.seed({ id: 'run-fail-zero', orgId, projectId, state: 'PLANNING' });
      coordinator.setPlanningHook(() => ({
        kind: 'failed',
        reason: 'zero_eligible_sources',
      }));
      await coordinator.executeTick({ runId: 'run-fail-zero' });
      expect((await store.getById('run-fail-zero'))?.state).toBe('FAILED');

      store.seed({ id: 'run-no-task-fail', orgId, projectId, state: 'RUNNING' });
      await expect(
        transitions.transition({
          runId: 'run-no-task-fail',
          toState: 'FAILED',
          failedReason: 'planning_failure',
        }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  it('task-level coverage gaps yield COMPLETED_PARTIAL, never FAILED', async () => {
    await runWithCorrelationIdAsync('corr-partial', async () => {
      const { store, coordinator } = createHarness();
      store.seed({
        id: 'run-partial',
        orgId,
        projectId,
        state: 'COMPLETING',
        coverage: {
          schemaVersion: 1,
          discovery: {
            requested: 2,
            discovered: 2,
            eligible: 2,
            excluded: 0,
            included: 2,
          },
          processing: {
            requested: 2,
            admitted: 2,
            completed: 1,
            partial: 0,
            failed: 1,
            unresolved: 0,
          },
        },
      });

      const outcome = await coordinator.executeTick({ runId: 'run-partial' });
      expect(outcome.kind).toBe('transitioned');
      if (outcome.kind === 'transitioned') {
        expect(outcome.toState).toBe('COMPLETED_PARTIAL');
      }
      expect((await store.getById('run-partial'))?.state).toBe('COMPLETED_PARTIAL');
    });
  });

  it('cancels from each non-terminal state', async () => {
    await runWithCorrelationIdAsync('corr-cancel', async () => {
      const nonTerminal = [
        'CREATED',
        'PLANNING',
        'RUNNING',
        'PAUSED_BUDGET',
        'PAUSED_MANUAL',
        'COMPLETING',
      ] as const;

      for (const state of nonTerminal) {
        const { store, coordinator } = createHarness();
        store.seed({ id: `run-${state}`, orgId, projectId, state });
        const result = await coordinator.cancel(`run-${state}`);
        expect(result.kind).toBe('applied');
        expect((await store.getById(`run-${state}`))?.state).toBe('CANCELLED');
      }
    });
  });

  it('rejects forbidden transitions with InvalidStateTransition', async () => {
    await runWithCorrelationIdAsync('corr-forbid', async () => {
      const { store, transitions } = createHarness();
      store.seed({ id: 'run-x', orgId, projectId, state: 'RUNNING' });
      await expect(
        transitions.transition({ runId: 'run-x', toState: 'COMPLETED' }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidStateTransition });
    });
  });

  it('RUNNING with no ready/in-flight/pending steps enters COMPLETING', async () => {
    await runWithCorrelationIdAsync('corr-complete', async () => {
      const { store, coordinator } = createHarness();
      store.seed({
        id: 'run-done',
        orgId,
        projectId,
        state: 'RUNNING',
        coverage: emptyResearchRunCoverage(),
      });
      store.setStepCounts('run-done', { ready: 0, inFlight: 0, pending: 0 });
      const outcome = await coordinator.executeTick({ runId: 'run-done' });
      expect(outcome.kind).toBe('transitioned');
      expect((await store.getById('run-done'))?.state).toBe('COMPLETING');
    });
  });

  it('pauses on budget boundary when ready steps remain', async () => {
    await runWithCorrelationIdAsync('corr-budget', async () => {
      const { store, coordinator } = createHarness();
      store.seed({
        id: 'run-budget',
        orgId,
        projectId,
        state: 'RUNNING',
        reservedMicros: 100n,
        consumedMicros: 100n,
      });
      store.setStepCounts('run-budget', { ready: 2, inFlight: 0, pending: 0 });
      await coordinator.executeTick({ runId: 'run-budget' });
      expect((await store.getById('run-budget'))?.state).toBe('PAUSED_BUDGET');
    });
  });
});

describe('GAP-COORD-LOCK-01 version guard (DHB-64)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';

  it('two racing coordinators with lock disabled still produce one correct outcome', async () => {
    await runWithCorrelationIdAsync('corr-race', async () => {
      const store = new MemoryResearchRunStore();
      store.seed({ id: 'run-race', orgId, projectId, state: 'CREATED', version: 0 });
      const a = createHarness(store);
      const b = createHarness(store);
      a.coordination.setAdvisoryLocksEnabled(false);
      b.coordination.setAdvisoryLocksEnabled(false);

      let entered = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      store.beforeCommit = async () => {
        entered += 1;
        if (entered >= 2) {
          release();
        }
        await barrier;
      };

      const [first, second] = await Promise.all([
        a.coordinator.executeTick({ runId: 'run-race' }),
        b.coordinator.executeTick({ runId: 'run-race' }),
      ]);

      const kinds = [first.kind, second.kind].sort();
      expect(kinds).toEqual(['transitioned', 'version_conflict']);
      const run = await store.getById('run-race');
      expect(run?.state).toBe('PLANNING');
      expect(run?.version).toBe(1);
      expect(store.listOutbox()).toHaveLength(1);
    });
  });

  it('does not require the advisory lock for correctness', async () => {
    const coordination = new ResearchRunCoordinationService();
    coordination.setAdvisoryLocksEnabled(false);
    const seen: string[] = [];
    await coordination.withAdvisoryLock('noop', async () => {
      seen.push('ran');
      return 'ok';
    });
    expect(seen).toEqual(['ran']);
    expect(coordination.areAdvisoryLocksEnabled()).toBe(false);
  });
});

describe('ResearchRun reliability (DHB-64 §25.2)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';

  it('crash mid-tick recovers with no duplicate run and no duplicate charge', async () => {
    await runWithCorrelationIdAsync('corr-crash', async () => {
      const { store, coordinator, metrics } = createHarness();
      store.seed({ id: 'run-crash', orgId, projectId, state: 'CREATED' });
      coordinator.resetAppliedChargeCount();
      store.abortNextTransition = true;

      await expect(coordinator.executeTick({ runId: 'run-crash' })).rejects.toThrow(
        /simulated coordinator crash/,
      );
      expect((await store.getById('run-crash'))?.state).toBe('CREATED');
      expect(coordinator.getAppliedChargeCount()).toBe(0);
      expect(store.listOutbox()).toHaveLength(0);

      const recovered = await coordinator.executeTick({
        runId: 'run-crash',
        recovery: true,
      });
      expect(recovered.kind).toBe('transitioned');
      expect((await store.getById('run-crash'))?.state).toBe('PLANNING');
      expect(coordinator.getAppliedChargeCount()).toBe(1);
      expect(metrics.snapshot().recoveryCount).toBe(1);
    });
  });

  it('duplicate jobId submission is a no-op at the natural-key level', async () => {
    const { deriveJobId } = await import('../../src/platform/queues/deterministic-job-id');
    const payload = {
      orgId,
      projectId,
      runId: 'run-dedup',
      correlationId: 'c1',
    };
    const first = deriveJobId('research-run-tick', payload);
    const second = deriveJobId('research-run-tick', {
      ...payload,
      correlationId: 'c2',
    });
    expect(first).toBe(second);
    expect(first).not.toContain(':');
  });
});

describe('ResearchRun DI token wiring sanity', () => {
  it('exposes RESEARCH_RUN_STORE symbol', () => {
    expect(RESEARCH_RUN_STORE).toBeDefined();
  });
});
