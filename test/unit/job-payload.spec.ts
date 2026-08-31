import { Test } from '@nestjs/testing';
import { JobEnqueueService } from '../../src/platform/logging/job-enqueue.service';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import {
  InvalidJobPayloadError,
  assertValidJobPayload,
} from '../../src/platform/logging/job-payload';
import { runWithCorrelationId } from '../../src/platform/logging/correlation-context';
import { CACHE_SERVICE, COUNTER_SERVICE, QUEUE_SERVICE } from '../../src/l0/ports';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { resetAppConfigForTests } from '../../src/platform/config';

describe('job payload contract', () => {
  const mockQueueService = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn(),
    addJob: jest.fn().mockResolvedValue('job-123'),
    addDlqJob: jest.fn().mockResolvedValue('dlq-123'),
    getJobState: jest.fn().mockResolvedValue(null),
    retryFailedJob: jest.fn().mockResolvedValue('noop'),
    getQueueDepth: jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      failed: 0,
      delayed: 0,
    }),
    processJobs: async () => ({ close: async () => undefined }),
  };

  const mockCounterService = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn().mockResolvedValue(true),
    incrementIfBelow: jest.fn().mockResolvedValue(true),
    decrement: jest.fn().mockResolvedValue(0),
    get: jest.fn().mockResolvedValue(0),
  };

  const mockCacheService = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(() => {
    installTestAppConfig();
  });

  afterAll(() => {
    resetAppConfigForTests();
  });

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
      .overrideProvider(COUNTER_SERVICE)
      .useValue(mockCounterService)
      .overrideProvider(CACHE_SERVICE)
      .useValue(mockCacheService)
      .compile();

    const enqueue = moduleRef.get(JobEnqueueService);

    await runWithCorrelationId('cor-enqueue-1', async () => {
      await enqueue.enqueue('billing-sync', {
        orgId: 'org-1',
        stripeEventId: 'evt_123',
      });
    });

    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      'billing-sync',
      {
        orgId: 'org-1',
        stripeEventId: 'evt_123',
        correlationId: 'cor-enqueue-1',
      },
      expect.objectContaining({
        jobId: expect.stringMatching(/^[a-f0-9]{64}$/),
        attempts: 5,
      }),
    );

    await moduleRef.close();
  });
});
