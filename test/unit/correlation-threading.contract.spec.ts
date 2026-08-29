import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { QUEUE_SERVICE } from '../../src/l0/ports';
import { resetAppConfigForTests } from '../../src/platform/config';
import {
  consumeJobPayload,
  correlationExpressMiddleware,
  InMemoryExecutionRecordWriter,
  JobEnqueueService,
  LoggerModule,
  PlatformLogger,
} from '../../src/platform/logging';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

@Controller('thread')
class ThreadProbeController {
  constructor(private readonly enqueue: JobEnqueueService) {}

  @Get()
  async threadProbe(): Promise<{ queued: boolean }> {
    await this.enqueue.enqueue('research.run', {
      orgId: 'org-thread-1',
      projectId: 'proj-thread-1',
      kind: 'contract-probe',
    });
    return { queued: true };
  }
}

@Module({
  imports: [LoggerModule],
  controllers: [ThreadProbeController],
})
class ThreadProbeModule {}

describe('correlation threading contract (HTTP → log → job → execution)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let logger: PlatformLogger;
  let writer: InMemoryExecutionRecordWriter;
  const mockQueueService = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn(),
    addJob: jest.fn().mockImplementation(async (_queue: string, data: unknown) => {
      consumeJobPayload(data, writer, logger);
      return 'job-contract-1';
    }),
  };

  beforeAll(async () => {
    installTestAppConfig();
    writer = new InMemoryExecutionRecordWriter();
    const moduleRef = await Test.createTestingModule({
      imports: [ThreadProbeModule],
    })
      .overrideProvider(QUEUE_SERVICE)
      .useValue(mockQueueService)
      .compile();

    logger = moduleRef.get(PlatformLogger);
    app = moduleRef.createNestApplication();
    app.use(correlationExpressMiddleware);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    resetAppConfigForTests();
  });

  beforeEach(() => {
    writer.clear();
    jest.clearAllMocks();
  });

  it('threads one correlationId through HTTP, logs, job payload, and execution record', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    const suppliedId = 'cor-contract-thread-1';

    const response = await fetch(`${baseUrl}/thread`, {
      headers: {
        [CORRELATION_ID_HEADER]: suppliedId,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe(suppliedId);
    expect(await response.json()).toEqual({ queued: true });

    expect(mockQueueService.addJob).toHaveBeenCalledWith(
      'research.run',
      expect.objectContaining({
        correlationId: suppliedId,
        orgId: 'org-thread-1',
        projectId: 'proj-thread-1',
      }),
    );

    expect(writer.getRecords()).toEqual([
      {
        correlationId: suppliedId,
        orgId: 'org-thread-1',
        projectId: 'proj-thread-1',
      },
    ]);

    const workerLog = infoSpy.mock.calls.find(
      (call) => (call[0] as { message?: string }).message === 'job.received',
    );
    expect(workerLog?.[0]).toMatchObject({
      module: 'worker',
      message: 'job.received',
      orgId: 'org-thread-1',
      projectId: 'proj-thread-1',
    });

    infoSpy.mockRestore();
  });

  it('rejects consumer payloads missing required correlation fields', () => {
    expect(() => consumeJobPayload({ orgId: 'org-1' }, writer, logger)).toThrow(
      'Job payload is missing correlationId',
    );
  });
});
