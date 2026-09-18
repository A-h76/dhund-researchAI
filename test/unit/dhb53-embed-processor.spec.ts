import { generateId } from '../../src/platform/ids/uuid-v7';
import { EMBED_MODEL_VERSION } from '../../src/ai/policy/embed-policy.constants';
import { EmbedProcessor } from '../../src/apps/worker/embed.processor';
import { EmbedBackfillProcessor } from '../../src/apps/worker/embed-backfill.processor';
import {
  EmbedService,
  EmbedUnrecoverableError,
} from '../../src/ai/embed/embed.service';
import { EmbedBackfillService } from '../../src/ai/embed/embed-backfill.service';
import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';
import type { QueueService } from '../../src/l0/ports';
import type { JobHeartbeatService } from '../../src/platform/reliability/job-heartbeat.service';
import type { DlqService } from '../../src/platform/queues/dlq.service';

describe('DHB-53 embed processor', () => {
  function createProcessor(embed: { run: jest.Mock; markDocumentPartial: jest.Mock }) {
    const registry = new ProcessorRegistry();
    const consume = jest.fn().mockResolvedValue(undefined);
    const heartbeat = {
      startJob: jest.fn().mockResolvedValue(undefined),
      renew: jest.fn().mockResolvedValue(true),
      complete: jest.fn().mockResolvedValue(undefined),
    };
    const dlq = { routeExhaustedJob: jest.fn().mockResolvedValue('dlq-1') };
    const processor = new EmbedProcessor(
      registry,
      { consume } as unknown as QueueService,
      embed as unknown as EmbedService,
      heartbeat as unknown as JobHeartbeatService,
      dlq as unknown as DlqService,
    );
    return { processor, registry, consume, heartbeat, dlq };
  }

  function job(overrides?: { attemptsMade?: number; attempts?: number }) {
    return {
      id: 'job-embed-1',
      attemptsMade: overrides?.attemptsMade ?? 0,
      attempts: overrides?.attempts ?? 5,
      data: {
        orgId: generateId(),
        projectId: generateId(),
        correlationId: 'cor-embed',
        chunkId: generateId(),
        modelVersion: EMBED_MODEL_VERSION,
        contentHash: 'f'.repeat(64),
      },
    };
  }

  it('registers embed, heartbeats, and DLQs unrecoverable failures as partial', async () => {
    const embed = {
      run: jest.fn().mockRejectedValue(
        new EmbedUnrecoverableError('dimension_mismatch', 'wrong width'),
      ),
      markDocumentPartial: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, registry, consume, heartbeat, dlq } = createProcessor(embed);
    await processor.onModuleInit();
    expect(registry.listProcessors()).toContain('embed');
    expect(consume).toHaveBeenCalledWith('embed', expect.any(Function));

    const payload = job();
    await processor.handle(payload);
    expect(heartbeat.startJob).toHaveBeenCalled();
    expect(heartbeat.complete).toHaveBeenCalled();
    expect(embed.markDocumentPartial).toHaveBeenCalledWith(payload.data.chunkId);
    expect(dlq.routeExhaustedJob).toHaveBeenCalledWith(
      expect.objectContaining({ queueName: 'embed', jobId: 'job-embed-1' }),
    );
  });

  it('rethrows retryable failures until the 5 attempts are exhausted', async () => {
    const embed = {
      run: jest.fn().mockRejectedValue(new Error('gateway timeout')),
      markDocumentPartial: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, dlq } = createProcessor(embed);
    await expect(processor.handle(job({ attemptsMade: 0, attempts: 5 }))).rejects.toThrow(
      'gateway timeout',
    );
    expect(embed.markDocumentPartial).not.toHaveBeenCalled();
    expect(dlq.routeExhaustedJob).not.toHaveBeenCalled();
  });

  it('marks the document partial when retries are exhausted', async () => {
    const embed = {
      run: jest.fn().mockRejectedValue(new Error('gateway timeout')),
      markDocumentPartial: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, dlq } = createProcessor(embed);
    const payload = job({ attemptsMade: 4, attempts: 5 });
    await expect(processor.handle(payload)).rejects.toThrow('gateway timeout');
    expect(embed.markDocumentPartial).toHaveBeenCalledWith(payload.data.chunkId);
    expect(dlq.routeExhaustedJob).toHaveBeenCalled();
  });
});

describe('DHB-53 embed-backfill processor', () => {
  it('registers embed-backfill and DLQs unrecoverable failures without degrading documents', async () => {
    const registry = new ProcessorRegistry();
    const consume = jest.fn().mockResolvedValue(undefined);
    const heartbeat = {
      startJob: jest.fn().mockResolvedValue(undefined),
      renew: jest.fn().mockResolvedValue(true),
      complete: jest.fn().mockResolvedValue(undefined),
    };
    const dlq = { routeExhaustedJob: jest.fn().mockResolvedValue('dlq-1') };
    const backfill = {
      run: jest.fn().mockRejectedValue(
        new EmbedUnrecoverableError('write', 'insert failed'),
      ),
    };
    const processor = new EmbedBackfillProcessor(
      registry,
      { consume } as unknown as QueueService,
      backfill as unknown as EmbedBackfillService,
      heartbeat as unknown as JobHeartbeatService,
      dlq as unknown as DlqService,
    );

    await processor.onModuleInit();
    expect(registry.listProcessors()).toContain('embed-backfill');

    await processor.handle({
      id: 'job-backfill-1',
      attemptsMade: 0,
      attempts: 3,
      data: {
        orgId: generateId(),
        correlationId: 'cor-backfill',
        operatorId: generateId(),
        modelVersion: EMBED_MODEL_VERSION,
        batchId: 'batch-1',
        scope: { allProjects: true, projects: [], documentIds: [] },
      },
    });

    expect(dlq.routeExhaustedJob).toHaveBeenCalledWith(
      expect.objectContaining({ queueName: 'embed-backfill', jobId: 'job-backfill-1' }),
    );
  });
});
