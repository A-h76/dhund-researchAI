import { Test } from '@nestjs/testing';
import { ApiAppModule } from '../../src/apps/api/api-app.module';
import { WorkerAppModule } from '../../src/apps/worker/worker-app.module';
import { CACHE_SERVICE, COUNTER_SERVICE, LEASE_SERVICE, OUTBOX_SERVICE, PUBSUB_SERVICE, QUEUE_SERVICE } from '../../src/l0/ports';
import {
  BootstrapValidationService,
  resetAppConfigForTests,
} from '../../src/platform/config';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

const mockQueueService = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
  addJob: jest.fn().mockResolvedValue('job-1'),
  addDlqJob: jest.fn().mockResolvedValue('dlq-1'),
  getJobState: jest.fn().mockResolvedValue(null),
  retryFailedJob: jest.fn().mockResolvedValue('noop'),
  getQueueDepth: jest.fn().mockResolvedValue({ waiting: 0, active: 0, failed: 0, delayed: 0 }),
};

const mockCounterService = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
  incrementIfBelow: jest.fn().mockResolvedValue(true),
  decrement: jest.fn().mockResolvedValue(0),
  get: jest.fn().mockResolvedValue(0),
};

const mockCacheService = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

const mockLeaseService = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
  tryAcquire: jest.fn().mockResolvedValue('acquired'),
  renew: jest.fn().mockResolvedValue(true),
  release: jest.fn().mockResolvedValue(true),
  getHolder: jest.fn().mockResolvedValue(null),
};

const mockOutboxService = {
  withTransaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) =>
    work({ __brand: 'OutboxTransaction' }),
  ),
  append: jest.fn().mockResolvedValue(undefined),
  appendStateMarker: jest.fn().mockResolvedValue(undefined),
  listUnrelayedOrdered: jest.fn().mockResolvedValue([]),
  markRelayed: jest.fn().mockResolvedValue(undefined),
  incrementAttempt: jest.fn().mockResolvedValue(undefined),
  countUnrelayed: jest.fn().mockResolvedValue(0),
  oldestUnrelayedCreatedAt: jest.fn().mockResolvedValue(null),
};

const mockPubSubService = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
  publish: jest.fn().mockResolvedValue(undefined),
};

const mockBootstrapValidation = {
  onApplicationBootstrap: jest.fn().mockResolvedValue(undefined),
};

describe('role module selection', () => {
  beforeAll(() => {
    installTestAppConfig();
  });

  afterAll(() => {
    resetAppConfigForTests();
  });

  it('api module compiles with HTTP controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule],
    })
      .overrideProvider(BootstrapValidationService)
      .useValue(mockBootstrapValidation)
      .compile();

    expect(moduleRef.get(ApiAppModule)).toBeDefined();
    await moduleRef.close();
  });

  it('worker module compiles without HTTP controllers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerAppModule],
    })
      .overrideProvider(QUEUE_SERVICE)
      .useValue(mockQueueService)
      .overrideProvider(COUNTER_SERVICE)
      .useValue(mockCounterService)
      .overrideProvider(CACHE_SERVICE)
      .useValue(mockCacheService)
      .overrideProvider(LEASE_SERVICE)
      .useValue(mockLeaseService)
      .overrideProvider(OUTBOX_SERVICE)
      .useValue(mockOutboxService)
      .overrideProvider(PUBSUB_SERVICE)
      .useValue(mockPubSubService)
      .overrideProvider(BootstrapValidationService)
      .useValue(mockBootstrapValidation)
      .compile();

    expect(moduleRef.get(WorkerAppModule)).toBeDefined();
    await moduleRef.close();
  });
});
