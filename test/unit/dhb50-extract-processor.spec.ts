import { generateId } from '../../src/platform/ids/uuid-v7';
import { EXTRACTOR_VERSION } from '../../src/ingestion/upload.constants';
import { ExtractProcessor } from '../../src/apps/worker/extract.processor';
import { ExtractService, ExtractUnrecoverableError } from '../../src/ingestion/extract.service';
import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';
import type { QueueService } from '../../src/l0/ports';
import type { JobHeartbeatService } from '../../src/platform/reliability/job-heartbeat.service';
import type { DlqService } from '../../src/platform/queues/dlq.service';

describe('DHB-50 extract processor', () => {
  function createProcessor(extract: {
    run: jest.Mock;
    failDocument: jest.Mock;
  }): {
    processor: ExtractProcessor;
    registry: ProcessorRegistry;
    consume: jest.Mock;
    heartbeat: {
      startJob: jest.Mock;
      renew: jest.Mock;
      complete: jest.Mock;
    };
    dlq: { routeExhaustedJob: jest.Mock };
  } {
    const registry = new ProcessorRegistry();
    const consume = jest.fn().mockResolvedValue(undefined);
    const heartbeat = {
      startJob: jest.fn().mockResolvedValue(undefined),
      renew: jest.fn().mockResolvedValue(true),
      complete: jest.fn().mockResolvedValue(undefined),
    };
    const dlq = { routeExhaustedJob: jest.fn().mockResolvedValue('dlq-1') };
    const processor = new ExtractProcessor(
      registry,
      { consume } as unknown as QueueService,
      extract as unknown as ExtractService,
      heartbeat as unknown as JobHeartbeatService,
      dlq as unknown as DlqService,
    );
    return { processor, registry, consume, heartbeat, dlq };
  }

  function job(overrides?: { attemptsMade?: number; attempts?: number }) {
    return {
      id: 'job-extract-1',
      attemptsMade: overrides?.attemptsMade ?? 0,
      attempts: overrides?.attempts ?? 5,
      data: {
        orgId: generateId(),
        projectId: generateId(),
        correlationId: 'cor-extract',
        documentVersionId: generateId(),
        contentHash: 'a'.repeat(64),
        extractorVersion: EXTRACTOR_VERSION,
      },
    };
  }

  it('registers extract, heartbeats, and DLQs unrecoverable failures as failed not completed', async () => {
    const extract = {
      run: jest.fn().mockRejectedValue(new ExtractUnrecoverableError('invalid_pdf', 'not_pdf')),
      failDocument: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, registry, consume, heartbeat, dlq } = createProcessor(extract);
    await processor.onModuleInit();
    expect(registry.listProcessors()).toContain('extract');
    expect(consume).toHaveBeenCalledWith('extract', expect.any(Function));

    const payload = job();
    await processor.handle(payload);

    expect(heartbeat.startJob).toHaveBeenCalled();
    expect(heartbeat.complete).toHaveBeenCalled();
    expect(extract.failDocument).toHaveBeenCalledWith(payload.data.documentVersionId);
    expect(dlq.routeExhaustedJob).toHaveBeenCalledWith(
      expect.objectContaining({ queueName: 'extract', jobId: 'job-extract-1' }),
    );
  });

  it('rethrows retryable failures without failing the document until attempts are exhausted', async () => {
    const extract = {
      run: jest.fn().mockRejectedValue(new Error('storage miss')),
      failDocument: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, dlq } = createProcessor(extract);
    await expect(processor.handle(job({ attemptsMade: 0, attempts: 5 }))).rejects.toThrow(
      'storage miss',
    );
    expect(extract.failDocument).not.toHaveBeenCalled();
    expect(dlq.routeExhaustedJob).not.toHaveBeenCalled();
  });

  it('marks failed and DLQs when retryable work is exhausted', async () => {
    const extract = {
      run: jest.fn().mockRejectedValue(new Error('storage miss')),
      failDocument: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, dlq } = createProcessor(extract);
    const payload = job({ attemptsMade: 4, attempts: 5 });
    await expect(processor.handle(payload)).rejects.toThrow('storage miss');
    expect(extract.failDocument).toHaveBeenCalledWith(payload.data.documentVersionId);
    expect(dlq.routeExhaustedJob).toHaveBeenCalled();
  });
});
