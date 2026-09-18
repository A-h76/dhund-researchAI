import { generateId } from '../../src/platform/ids/uuid-v7';
import { CHUNKER_VERSION } from '../../src/ingestion/extract.constants';
import { ChunkProcessor } from '../../src/apps/worker/chunk.processor';
import {
  ChunkService,
  ChunkUnrecoverableError,
} from '../../src/ingestion/chunk.service';
import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';
import type { QueueService } from '../../src/l0/ports';
import type { JobHeartbeatService } from '../../src/platform/reliability/job-heartbeat.service';
import type { DlqService } from '../../src/platform/queues/dlq.service';

describe('DHB-52 chunk processor', () => {
  function createProcessor(chunk: { run: jest.Mock; failDocument: jest.Mock }) {
    const registry = new ProcessorRegistry();
    const consume = jest.fn().mockResolvedValue(undefined);
    const heartbeat = {
      startJob: jest.fn().mockResolvedValue(undefined),
      renew: jest.fn().mockResolvedValue(true),
      complete: jest.fn().mockResolvedValue(undefined),
    };
    const dlq = { routeExhaustedJob: jest.fn().mockResolvedValue('dlq-1') };
    const processor = new ChunkProcessor(
      registry,
      { consume } as unknown as QueueService,
      chunk as unknown as ChunkService,
      heartbeat as unknown as JobHeartbeatService,
      dlq as unknown as DlqService,
    );
    return { processor, registry, consume, heartbeat, dlq };
  }

  function job(overrides?: { attemptsMade?: number; attempts?: number }) {
    return {
      id: 'job-chunk-1',
      attemptsMade: overrides?.attemptsMade ?? 0,
      attempts: overrides?.attempts ?? 5,
      data: {
        orgId: generateId(),
        projectId: generateId(),
        correlationId: 'cor-chunk',
        documentVersionId: generateId(),
        chunkerVersion: CHUNKER_VERSION,
        contentHash: 'f'.repeat(64),
      },
    };
  }

  it('registers chunk, heartbeats, and DLQs unrecoverable failures via failDocument', async () => {
    const chunk = {
      run: jest.fn().mockRejectedValue(new ChunkUnrecoverableError('no_blocks', 'none')),
      failDocument: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, registry, consume, heartbeat, dlq } = createProcessor(chunk);
    await processor.onModuleInit();
    expect(registry.listProcessors()).toContain('chunk');
    expect(consume).toHaveBeenCalledWith('chunk', expect.any(Function));

    const payload = job();
    await processor.handle(payload);
    expect(heartbeat.startJob).toHaveBeenCalled();
    expect(heartbeat.complete).toHaveBeenCalled();
    expect(chunk.failDocument).toHaveBeenCalledWith(payload.data.documentVersionId);
    expect(dlq.routeExhaustedJob).toHaveBeenCalledWith(
      expect.objectContaining({ queueName: 'chunk', jobId: 'job-chunk-1' }),
    );
  });

  it('rethrows retryable failures until the 5 attempts are exhausted', async () => {
    const chunk = {
      run: jest.fn().mockRejectedValue(new Error('db timeout')),
      failDocument: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, dlq } = createProcessor(chunk);
    await expect(processor.handle(job({ attemptsMade: 0, attempts: 5 }))).rejects.toThrow(
      'db timeout',
    );
    expect(chunk.failDocument).not.toHaveBeenCalled();
    expect(dlq.routeExhaustedJob).not.toHaveBeenCalled();

    const exhausted = {
      run: jest.fn().mockRejectedValue(new Error('db timeout')),
      failDocument: jest.fn().mockResolvedValue(undefined),
    };
    const last = createProcessor(exhausted);
    await expect(
      last.processor.handle(job({ attemptsMade: 4, attempts: 5 })),
    ).rejects.toThrow('db timeout');
    expect(exhausted.failDocument).toHaveBeenCalled();
    expect(last.dlq.routeExhaustedJob).toHaveBeenCalled();
  });
});
