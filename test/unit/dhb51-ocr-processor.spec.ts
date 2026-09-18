import { generateId } from '../../src/platform/ids/uuid-v7';
import { EXTRACTOR_VERSION } from '../../src/ingestion/upload.constants';
import { OcrProcessor } from '../../src/apps/worker/ocr.processor';
import { OcrService, OcrUnrecoverableError } from '../../src/ai/ocr/ocr.service';
import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';
import type { QueueService } from '../../src/l0/ports';
import type { JobHeartbeatService } from '../../src/platform/reliability/job-heartbeat.service';
import type { DlqService } from '../../src/platform/queues/dlq.service';

describe('DHB-51 OCR processor', () => {
  function createProcessor(ocr: { run: jest.Mock; failDocument: jest.Mock }) {
    const registry = new ProcessorRegistry();
    const consume = jest.fn().mockResolvedValue(undefined);
    const heartbeat = {
      startJob: jest.fn().mockResolvedValue(undefined),
      renew: jest.fn().mockResolvedValue(true),
      complete: jest.fn().mockResolvedValue(undefined),
    };
    const dlq = { routeExhaustedJob: jest.fn().mockResolvedValue('dlq-1') };
    const processor = new OcrProcessor(
      registry,
      { consume } as unknown as QueueService,
      ocr as unknown as OcrService,
      heartbeat as unknown as JobHeartbeatService,
      dlq as unknown as DlqService,
    );
    return { processor, registry, consume, heartbeat, dlq };
  }

  function job(overrides?: { attemptsMade?: number; attempts?: number }) {
    return {
      id: 'job-ocr-1',
      attemptsMade: overrides?.attemptsMade ?? 0,
      attempts: overrides?.attempts ?? 3,
      data: {
        orgId: generateId(),
        projectId: generateId(),
        correlationId: 'cor-ocr',
        documentVersionId: generateId(),
        contentHash: 'e'.repeat(64),
        extractorVersion: EXTRACTOR_VERSION,
        blockRefs: [1],
      },
    };
  }

  it('registers ocr, heartbeats, and DLQs unrecoverable failures as failed not completed', async () => {
    const ocr = {
      run: jest.fn().mockRejectedValue(new OcrUnrecoverableError('empty_ocr', 'empty')),
      failDocument: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, registry, consume, heartbeat, dlq } = createProcessor(ocr);
    await processor.onModuleInit();
    expect(registry.listProcessors()).toContain('ocr');
    expect(consume).toHaveBeenCalledWith('ocr', expect.any(Function));

    const payload = job();
    await processor.handle(payload);
    expect(heartbeat.startJob).toHaveBeenCalled();
    expect(heartbeat.complete).toHaveBeenCalled();
    expect(ocr.failDocument).toHaveBeenCalledWith(payload.data.documentVersionId);
    expect(dlq.routeExhaustedJob).toHaveBeenCalledWith(
      expect.objectContaining({ queueName: 'ocr', jobId: 'job-ocr-1' }),
    );
  });

  it('rethrows retryable failures until attempts are exhausted', async () => {
    const ocr = {
      run: jest.fn().mockRejectedValue(new Error('gateway timeout')),
      failDocument: jest.fn().mockResolvedValue(undefined),
    };
    const { processor, dlq } = createProcessor(ocr);
    await expect(processor.handle(job({ attemptsMade: 0, attempts: 3 }))).rejects.toThrow(
      'gateway timeout',
    );
    expect(ocr.failDocument).not.toHaveBeenCalled();
    expect(dlq.routeExhaustedJob).not.toHaveBeenCalled();
  });
});
