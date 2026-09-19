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
  return { store, metrics, coordinator, enqueue, transitions };
}

describe('DHB-67 ResearchRun finalization + coverage reporting', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';

  it('normal completion freezes full coverage and reaches COMPLETED', async () => {
    await runWithCorrelationIdAsync('corr-full', async () => {
      const { store, coordinator, enqueue, metrics } = createHarness();
      store.seed({
        id: 'run-full',
        orgId,
        projectId,
        preset: 'deep_research',
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
            completed: 2,
            partial: 0,
            failed: 0,
            unresolved: 0,
          },
        },
      });

      const outcome = await coordinator.executeTick({ runId: 'run-full' });
      expect(outcome.kind).toBe('transitioned');
      if (outcome.kind === 'transitioned') {
        expect(outcome.toState).toBe('COMPLETED');
      }
      const run = await store.getById('run-full');
      expect(run?.state).toBe('COMPLETED');
      expect(run?.coverage.processing.completed).toBe(2);
      expect(metrics.snapshot().completedCount).toBe(1);
      expect(enqueue.enqueue).toHaveBeenCalledWith(
        'research-artifact-generate',
        expect.objectContaining({
          artifactType: 'deep_research_report',
          runId: 'run-full',
          coverageSnapshotHash: expect.any(String),
        }),
      );
    });
  });

  it('partial run reports honest per-funnel numbers and reaches COMPLETED_PARTIAL', async () => {
    await runWithCorrelationIdAsync('corr-partial', async () => {
      const { store, coordinator, metrics } = createHarness();
      store.seed({
        id: 'run-partial',
        orgId,
        projectId,
        state: 'COMPLETING',
        coverage: {
          schemaVersion: 1,
          discovery: {
            requested: 100,
            discovered: 100,
            eligible: 100,
            excluded: 0,
            included: 100,
          },
          processing: {
            requested: 100,
            admitted: 100,
            completed: 40,
            partial: 0,
            failed: 10,
            unresolved: 50,
          },
        },
      });

      await coordinator.executeTick({ runId: 'run-partial' });
      const run = await store.getById('run-partial');
      expect(run?.state).toBe('COMPLETED_PARTIAL');
      expect(run?.coverage.discovery.requested).toBe(100);
      expect(run?.coverage.processing.completed).toBe(40);
      expect(metrics.snapshot().completedPartialCount).toBe(1);
      expect(metrics.snapshot().lastStepOutcomes).not.toBeNull();
      expect(metrics.snapshot().lastCoverage?.processing.completed).toBe(40);
    });
  });

  it('rejects finalizing with a coverage object missing a denominator', async () => {
    await runWithCorrelationIdAsync('corr-deny', async () => {
      const { store, transitions } = createHarness();
      store.seed({
        id: 'run-bad',
        orgId,
        projectId,
        state: 'COMPLETING',
        coverage: emptyResearchRunCoverage(),
      });

      await expect(
        transitions.transition({
          runId: 'run-bad',
          toState: 'COMPLETED',
          coverage: {
            schemaVersion: 1,
            discovery: {
              discovered: 1,
              eligible: 1,
              excluded: 0,
              included: 1,
            } as never,
            processing: emptyResearchRunCoverage().processing,
          },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
    });
  });

  it('rejects COMPLETED without any coverage object', async () => {
    await runWithCorrelationIdAsync('corr-missing', async () => {
      const { store, transitions } = createHarness();
      store.seed({ id: 'run-nocov', orgId, projectId, state: 'COMPLETING' });
      await expect(
        transitions.transition({ runId: 'run-nocov', toState: 'COMPLETED' }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });
});
