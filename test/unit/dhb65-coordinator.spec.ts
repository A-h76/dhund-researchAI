import { deriveJobId } from '../../src/platform/queues/deterministic-job-id';
import { emptyResearchRunCoverage } from '../../src/l0/ports/research-run-coverage';
import { OutboxWriterService } from '../../src/platform/events';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { ResearchRunCoordinationService } from '../../src/orchestration/research-run-coordination.service';
import { ResearchRunCoordinatorService } from '../../src/orchestration/research-run-coordinator.service';
import { ResearchRunMetrics } from '../../src/orchestration/research-run.metrics';
import { ResearchRunPlannerService } from '../../src/orchestration/research-run-planner.service';
import { ResearchRunTransitionService } from '../../src/orchestration/research-run-transition.service';
import { DEEP_RESEARCH_V1 } from '../../src/orchestration/presets/builtin-presets';
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
  const planner = new ResearchRunPlannerService(store, metrics);
  const coordinator = new ResearchRunCoordinatorService(
    store,
    transitions,
    coordination,
    metrics,
    enqueue as never,
    planner,
  );
  return { store, writer, metrics, coordination, transitions, coordinator, enqueue, planner };
}

describe('ResearchRun step dispatch (DHB-65)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';

  it('does not dispatch a dependent step before its prerequisite succeeds', async () => {
    await runWithCorrelationIdAsync('corr-deps', async () => {
      const { store, coordinator, enqueue } = createHarness();
      store.seed({ id: 'run-deps', orgId, projectId, state: 'PLANNING' });
      await coordinator.executeTick({ runId: 'run-deps' });
      await coordinator.executeTick({ runId: 'run-deps' });

      const steps = await store.listSteps('run-deps');
      expect(steps).toHaveLength(DEEP_RESEARCH_V1.nodes.length);
      const retrieve = steps.find((step) => step.stepType === 'retrieve');
      const admit = steps.find((step) => step.stepType === 'admit');
      expect(retrieve?.state).toBe('DISPATCHED');
      expect(admit?.state).toBe('PENDING');
      expect(enqueue.enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.enqueue.mock.calls[0]?.[1]).toMatchObject({
        stepType: 'retrieve',
        runId: 'run-deps',
      });
    });
  });

  it('dispatches the dependent step only after the prerequisite succeeds', async () => {
    await runWithCorrelationIdAsync('corr-deps-2', async () => {
      const { store, coordinator, enqueue } = createHarness();
      store.seed({ id: 'run-deps-2', orgId, projectId, state: 'PLANNING' });
      await coordinator.executeTick({ runId: 'run-deps-2' });
      await coordinator.executeTick({ runId: 'run-deps-2' });
      const retrieve = (await store.listSteps('run-deps-2')).find(
        (step) => step.stepType === 'retrieve',
      );
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
      await coordinator.executeTick({ runId: 'run-deps-2' });
      const admit = (await store.listSteps('run-deps-2')).find(
        (step) => step.stepType === 'admit',
      );
      expect(admit?.state).toBe('DISPATCHED');
      expect(enqueue.enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.enqueue.mock.calls[0]?.[1]).toMatchObject({ stepType: 'admit' });
    });
  });

  it('same step enqueued twice uses the same deterministic jobId', () => {
    const payload = {
      orgId,
      projectId,
      correlationId: 'c1',
      runId: 'run-1',
      stepId: 'step-1',
      stepType: 'retrieve',
      inputFingerprint: 'fp-1',
      stepVersion: 'v1',
    };
    const first = deriveJobId('research-run-step', payload);
    const second = deriveJobId('research-run-step', {
      ...payload,
      correlationId: 'c2',
      query: 'other',
    });
    expect(first).toBe(second);
    expect(first).not.toContain(':');
  });

  it('a failed step continues the run toward COMPLETED_PARTIAL, never FAILED', async () => {
    await runWithCorrelationIdAsync('corr-fail-step', async () => {
      const { store, coordinator } = createHarness();
      store.seed({
        id: 'run-fail-step',
        orgId,
        projectId,
        state: 'PLANNING',
        coverage: emptyResearchRunCoverage(),
      });
      await coordinator.executeTick({ runId: 'run-fail-step' });
      await coordinator.executeTick({ runId: 'run-fail-step' });
      const retrieve = (await store.listSteps('run-fail-step')).find(
        (step) => step.stepType === 'retrieve',
      );
      expect(retrieve).toBeDefined();
      if (retrieve === undefined) {
        return;
      }
      await store.transitionStep({
        stepId: retrieve.id,
        fromState: 'DISPATCHED',
        toState: 'FAILED',
        expectedVersion: retrieve.version,
      });

      const runningTick = await coordinator.executeTick({ runId: 'run-fail-step' });
      expect(runningTick.kind).toBe('transitioned');
      expect((await store.getById('run-fail-step'))?.state).toBe('COMPLETING');

      const completing = await coordinator.executeTick({ runId: 'run-fail-step' });
      expect(completing.kind).toBe('transitioned');
      expect((await store.getById('run-fail-step'))?.state).toBe('COMPLETED_PARTIAL');
    });
  });

  it('DEFERRED leftover steps at completing count as skipped', async () => {
    await runWithCorrelationIdAsync('corr-defer', async () => {
      const { store, coordinator } = createHarness();
      store.seed({ id: 'run-defer', orgId, projectId, state: 'PLANNING' });
      await coordinator.executeTick({ runId: 'run-defer' });
      await coordinator.executeTick({ runId: 'run-defer' });
      const retrieve = (await store.listSteps('run-defer')).find(
        (step) => step.stepType === 'retrieve',
      );
      if (retrieve === undefined) {
        return;
      }
      await store.transitionStep({
        stepId: retrieve.id,
        fromState: 'DISPATCHED',
        toState: 'FAILED',
        expectedVersion: retrieve.version,
      });
      await coordinator.executeTick({ runId: 'run-defer' });
      const counts = await store.countSteps('run-defer');
      expect(counts.failed).toBe(1);
      expect(counts.deferred).toBe(1);
      expect(counts.pending).toBe(0);
    });
  });
});
