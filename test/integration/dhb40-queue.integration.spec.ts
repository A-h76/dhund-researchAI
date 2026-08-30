import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import { GenericContainer, Wait } from 'testcontainers';
import { BullmqQueueAdapter } from '../../src/l0/adapters/bullmq/bullmq-queue.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { RedisCounterAdapter } from '../../src/l0/adapters/redis/redis-counter.adapter';
import { CACHE_SERVICE, COUNTER_SERVICE, QUEUE_SERVICE } from '../../src/l0/ports';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { JobEnqueueService } from '../../src/platform/logging/job-enqueue.service';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import {
  deriveJobId,
  DlqReplayService,
  DlqService,
  dlqNameFor,
  QueuesModule,
} from '../../src/platform/queues';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(integrationEnabled ? describe : describe.skip)('DHB-40 queue reliability (integration)', () => {
  jest.setTimeout(180_000);

  async function startRedis(): Promise<{ redisUrl: string; stop: () => Promise<unknown> }> {
    const container = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    return {
      redisUrl: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
      stop: () => container.stop(),
    };
  }

  function extractPayload() {
    return {
      orgId: 'org-int-1',
      projectId: 'proj-int-1',
      documentVersionId: 'dv-int-1',
      contentHash: 'hash-int-1',
      extractorVersion: 'ext-v1',
    };
  }

  async function createHarness(redisUrl: string): Promise<{
    adapter: BullmqQueueAdapter;
    enqueue: JobEnqueueService;
    dlq: DlqService;
    replay: DlqReplayService;
    close: () => Promise<void>;
  }> {
    installTestAppConfig({
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl,
      logLevel: 'silent',
    });

    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl,
      databasePoolSize: 10,
    };
    const adapter = new BullmqQueueAdapter(connectionConfig);
    const cache = new RedisCacheAdapter(connectionConfig);
    const counter = new RedisCounterAdapter(connectionConfig);
    await adapter.connect('dhb40');
    await cache.connect('dhb40');
    await counter.connect('dhb40');

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, QueuesModule],
    })
      .overrideProvider(QUEUE_SERVICE)
      .useValue(adapter)
      .overrideProvider(CACHE_SERVICE)
      .useValue(cache)
      .overrideProvider(COUNTER_SERVICE)
      .useValue(counter)
      .compile();

    return {
      adapter,
      enqueue: moduleRef.get(JobEnqueueService),
      dlq: moduleRef.get(DlqService),
      replay: moduleRef.get(DlqReplayService),
      close: async () => {
        await adapter.disconnect('dhb40');
        await cache.disconnect('dhb40');
        await counter.disconnect('dhb40');
        await moduleRef.close();
      },
    };
  }

  it('dedupes duplicate enqueue via deterministic jobId', async () => {
    const { redisUrl, stop } = await startRedis();
    const harness = await createHarness(redisUrl);
    const payload = extractPayload();

    let firstId = '';
    let secondId = '';
    await runWithCorrelationIdAsync('cor-dedupe-1', async () => {
      firstId = await harness.enqueue.enqueue('extract', payload);
      secondId = await harness.enqueue.enqueue('extract', payload);
    });

    expect(firstId).toBe(secondId);

    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue('extract', { connection });
    expect(await queue.getWaitingCount()).toBe(1);

    await queue.close();
    await connection.quit();
    await harness.close();
    await stop();
  });

  it('routes exhausted jobs to the queue DLQ without sensitive content', async () => {
    const { redisUrl, stop } = await startRedis();
    const harness = await createHarness(redisUrl);
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const payload = {
      ...extractPayload(),
      correlationId: 'cor-dlq-1',
      documentText: 'must-not-appear',
      promptText: 'must-not-appear',
    };
    const jobId = deriveJobId('extract', payload);

    const queueEvents = new QueueEvents('extract', { connection });
    await queueEvents.waitUntilReady();

    const failedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for failure')), 30_000);
      queueEvents.on('failed', async (event) => {
        if (event.jobId !== jobId) {
          return;
        }
        clearTimeout(timeout);
        try {
          await harness.dlq.routeExhaustedJob({
            queueName: 'extract',
            jobId,
            payload,
            errorMessage: 'poison failure',
            attemptCount: 1,
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    const worker = new Worker(
      'extract',
      async () => {
        throw new Error('poison failure');
      },
      { connection, concurrency: 1 },
    );
    await worker.waitUntilReady();

    const queue = new Queue('extract', { connection });
    await queue.add('extract', payload, {
      jobId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });

    await failedPromise;

    const dlqQueue = new Queue(dlqNameFor('extract'), { connection });
    const dlqJobs = await dlqQueue.getJobs(['waiting', 'completed', 'failed']);
    expect(dlqJobs.length).toBeGreaterThan(0);
    const dlqData = dlqJobs[0]?.data as Record<string, unknown>;
    expect(dlqData.documentText).toBeUndefined();
    expect(dlqData.promptText).toBeUndefined();
    expect(dlqData.orgId).toBe('org-int-1');
    expect(dlqData.queue).toBe('extract');

    await worker.close();
    await queueEvents.close();
    await dlqQueue.close();
    await queue.close();
    await connection.quit();
    await harness.close();
    await stop();
  });

  it('does not block subsequent valid jobs after a poison message', async () => {
    const { redisUrl, stop } = await startRedis();
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

    let processed = 0;
    const worker = new Worker(
      'stance',
      async (job) => {
        if (job.data.fail === true) {
          throw new Error('poison');
        }
        processed += 1;
      },
      { connection, concurrency: 1 },
    );

    const poisonPayload = {
      orgId: 'org-int-1',
      projectId: 'proj-int-1',
      correlationId: 'cor-poison-1',
      runId: 'run-1',
      evidenceId: 'ev-poison',
      fail: true,
    };
    const goodPayload = {
      orgId: 'org-int-1',
      projectId: 'proj-int-1',
      correlationId: 'cor-poison-2',
      runId: 'run-1',
      evidenceId: 'ev-good',
    };

    const queue = new Queue('stance', { connection });
    await queue.add('stance', poisonPayload, {
      jobId: deriveJobId('stance', poisonPayload),
      attempts: 1,
    });
    await queue.add('stance', goodPayload, {
      jobId: deriveJobId('stance', goodPayload),
      attempts: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(processed).toBe(1);
    expect(await queue.getFailedCount()).toBe(1);

    await worker.close();
    await queue.close();
    await connection.quit();
    await stop();
  });

  it('no-ops DLQ replay when the original job already completed', async () => {
    const { redisUrl, stop } = await startRedis();
    const harness = await createHarness(redisUrl);
    const payload = {
      orgId: 'org-int-1',
      stripeEventId: 'evt_replay_1',
    };

    let jobId = '';
    await runWithCorrelationIdAsync('cor-replay-1', async () => {
      jobId = await harness.enqueue.enqueue('billing-sync', payload);
    });

    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const queueEvents = new QueueEvents('billing-sync', { connection });
    await queueEvents.waitUntilReady();

    const completedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for completion')), 30_000);
      queueEvents.on('completed', (event) => {
        if (event.jobId === jobId) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const worker = new Worker(
      'billing-sync',
      async () => undefined,
      { connection, concurrency: 1 },
    );
    await worker.waitUntilReady();

    await completedPromise;

    expect(await harness.adapter.getJobState('billing-sync', jobId)).toBe('completed');
    const queue = new Queue('billing-sync', { connection });

    const dlqPayload = {
      queue: 'billing-sync',
      originalJobId: jobId,
      orgId: 'org-int-1',
      correlationId: 'cor-replay-1',
      naturalKey: { stripeEventId: 'evt_replay_1' },
      errorMessage: 'previous failure',
      failedAt: new Date().toISOString(),
      attemptCount: 5,
    };

    const result = await harness.replay.replay(dlqPayload, {
      ...payload,
      correlationId: 'cor-replay-1',
    });
    expect(result).toBe('noop');
    expect(await queue.getWaitingCount()).toBe(0);

    await worker.close();
    await queueEvents.close();
    await queue.close();
    await connection.quit();
    await harness.close();
    await stop();
  });
});
