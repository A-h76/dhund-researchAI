import { Test } from '@nestjs/testing';
import { JobEnqueueService } from '../../src/platform/logging/job-enqueue.service';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import {
  InvalidJobPayloadError,
  assertValidJobPayload,
} from '../../src/platform/logging/job-payload';
import { runWithCorrelationId } from '../../src/platform/logging/correlation-context';
import { QUEUE_SERVICE } from '../../src/l0/ports';

describe('job payload contract', () => {
  const mockQueueService = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn(),
    addJob: jest.fn().mockResolvedValue('job-123'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects payloads missing correlationId', () => {
    expect(() =>
      assertValidJobPayload({
        orgId: 'org-1',
      }),
    ).toThrow(InvalidJobPayloadError);
  });

  it('rejects payloads missing orgId', () => {
    expect(() =>
      assertValidJobPayload({
        correlationId: 'cor-1',
      }),
    ).toThrow(InvalidJobPayloadError);
  });

  it('accepts payloads with optional projectId', () => {
    expect(() =>
      assertValidJobPayload({
        correlationId: 'cor-1',
        orgId: 'org-1',
        projectId: 'proj-1',
      }),
    ).not.toThrow();
  });

  it('injects correlationId from ALS into enqueued payloads', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule],
    })
      .overrideProvider(QUEUE_SERVICE)
      .useValue(mockQueueService)
      .compile();

    const enqueue = moduleRef.get(JobEnqueueService);

    await runWithCorrelationId('cor-enqueue-1', async () => {
      await enqueue.enqueue('research.run', {
        orgId: 'org-1',
        projectId: 'proj-1',
        kind: 'probe',
      });
    });

    expect(mockQueueService.addJob).toHaveBeenCalledWith('research.run', {
      orgId: 'org-1',
      projectId: 'proj-1',
      kind: 'probe',
      correlationId: 'cor-enqueue-1',
    });

    await moduleRef.close();
  });
});
