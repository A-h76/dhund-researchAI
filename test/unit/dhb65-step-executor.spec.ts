import { OutboxWriterService } from '../../src/platform/events';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { ResearchRunMetrics } from '../../src/orchestration/research-run.metrics';
import { ResearchRunStepExecutor } from '../../src/apps/worker/research-run-step.executor';
import { MemoryResearchRunStore } from '../fixtures/memory-research-run-store';
import type { PlatformLogger } from '../../src/platform/logging';

function createExecutor(options?: {
  retrieve?: jest.Mock;
  enqueue?: jest.Mock;
}) {
  const store = new MemoryResearchRunStore();
  const retrieval = {
    retrieve: options?.retrieve ??
      jest.fn().mockResolvedValue({
        trace: { id: 'trace-durable-1', fingerprint: 'retrieval-fp-1' },
      }),
  };
  const enqueue = {
    enqueue: options?.enqueue ?? jest.fn().mockResolvedValue('extract-job-1'),
  };
  const extract = {
    execute: jest.fn().mockResolvedValue({ kind: 'completed' }),
  };
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
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  } as unknown as PlatformLogger;
  const executor = new ResearchRunStepExecutor(
    store,
    retrieval as never,
    enqueue as never,
    extract as never,
    new OutboxWriterService(outboxPort as never),
    new ResearchRunMetrics(logger),
  );
  return { store, retrieval, enqueue, extract, executor };
}

describe('ResearchRun step execution provenance (DHB-65)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';

  it('records RetrievalTrace fingerprint and durable result_ref on retrieve', async () => {
    await runWithCorrelationIdAsync('corr-retr', async () => {
      const { store, executor, retrieval } = createExecutor();
      store.seed({ id: 'run-retr', orgId, projectId });
      await store.createSteps('run-retr', [
        {
          id: 'step-retr',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'plan-fp',
          stepVersion: 'v1',
          state: 'DISPATCHED',
        },
      ]);

      await executor.execute({
        orgId,
        projectId,
        runId: 'run-retr',
        stepId: 'step-retr',
        stepType: 'retrieve',
        inputFingerprint: 'plan-fp',
        stepVersion: 'v1',
        correlationId: 'corr-retr',
        query: 'deep research',
      });

      expect(retrieval.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, query: 'deep research' }),
      );
      const step = await store.getStep('step-retr');
      expect(step?.state).toBe('SUCCEEDED');
      expect(step?.inputFingerprint).toBe('retrieval-fp-1');
      expect(step?.resultRef).toBe('trace-durable-1');
    });
  });

  it('admission requests the existing extract chain and does not invent a pipeline', async () => {
    await runWithCorrelationIdAsync('corr-admit', async () => {
      const enqueue = jest.fn().mockResolvedValue('extract-job-9');
      const { store, executor } = createExecutor({ enqueue });
      store.seed({ id: 'run-admit', orgId, projectId });
      await store.createSteps('run-admit', [
        {
          id: 'step-admit',
          stepType: 'admit',
          dependsOnStepIds: [],
          inputFingerprint: 'admit-fp',
          stepVersion: 'v1',
          state: 'DISPATCHED',
        },
      ]);

      await executor.execute({
        orgId,
        projectId,
        runId: 'run-admit',
        stepId: 'step-admit',
        stepType: 'admit',
        inputFingerprint: 'admit-fp',
        stepVersion: 'v1',
        correlationId: 'corr-admit',
        documentVersionId: 'dv-1',
        contentHash: 'hash-1',
      });

      expect(enqueue).toHaveBeenCalledWith(
        'extract',
        expect.objectContaining({
          documentVersionId: 'dv-1',
          contentHash: 'hash-1',
          extractorVersion: 'v1',
        }),
      );
      expect(enqueue.mock.calls.some((call) => call[0] === 'ocr')).toBe(false);
      const step = await store.getStep('step-admit');
      expect(step?.state).toBe('SUCCEEDED');
      expect(step?.resultRef).toBe('extract-job-9');
    });
  });

  it('does not re-execute a step that already succeeded', async () => {
    await runWithCorrelationIdAsync('corr-once', async () => {
      const retrieve = jest.fn();
      const { store, executor } = createExecutor({ retrieve });
      store.seed({ id: 'run-once', orgId, projectId });
      await store.createSteps('run-once', [
        {
          id: 'step-once',
          stepType: 'retrieve',
          dependsOnStepIds: [],
          inputFingerprint: 'fp',
          stepVersion: 'v1',
          state: 'SUCCEEDED',
        },
      ]);
      await executor.execute({
        orgId,
        projectId,
        runId: 'run-once',
        stepId: 'step-once',
        stepType: 'retrieve',
        inputFingerprint: 'fp',
        stepVersion: 'v1',
        correlationId: 'corr-once',
      });
      expect(retrieve).not.toHaveBeenCalled();
    });
  });
});
