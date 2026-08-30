import { GenericContainer, Wait } from 'testcontainers';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import { BullmqQueueAdapter } from '../../src/l0/adapters/bullmq/bullmq-queue.adapter';
import { RedisCounterAdapter } from '../../src/l0/adapters/redis/redis-counter.adapter';
import { COUNTER_SERVICE, QUEUE_SERVICE } from '../../src/l0/ports';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { ConcurrencyModule } from '../../src/platform/concurrency';
import { JobEnqueueService } from '../../src/platform/logging/job-enqueue.service';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import { QueuesModule } from '../../src/platform/queues';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(integrationEnabled ? describe : describe.skip)('DHB-42 concurrency gates (integration)', () => {
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

  const extractPayload = (orgId: string, suffix: string) => ({
    orgId,
    projectId: 'proj-int-1',
    documentVersionId: `dv-${suffix}`,
    contentHash: `hash-${suffix}`,
    extractorVersion: 'ext-v1',
  });

  it('prevents one org from monopolising batch admission slots', async () => {
    const { redisUrl, stop } = await startRedis();
    installTestAppConfig({ redisUrl, logLevel: 'silent' });

    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl,
      databasePoolSize: 10,
    };

    const adapter = new BullmqQueueAdapter(connectionConfig);
    const counter = new RedisCounterAdapter(connectionConfig);
    await adapter.connect('dhb42');
    await counter.connect('dhb42');

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, QueuesModule, ConcurrencyModule],
    })
      .overrideProvider(QUEUE_SERVICE)
      .useValue(adapter)
      .overrideProvider(COUNTER_SERVICE)
      .useValue(counter)
      .compile();

    const enqueue = moduleRef.get(JobEnqueueService);
    const orgA = 'org-a';
    const orgB = 'org-b';

    await runWithCorrelationIdAsync('cor-gate-1', async () => {
      for (let index = 0; index < 5; index += 1) {
        await enqueue.enqueue('extract', extractPayload(orgA, `a-${index}`), { orgBatchLimit: 5 });
      }
    });

    await expect(
      runWithCorrelationIdAsync('cor-gate-2', async () => {
        await enqueue.enqueue('extract', extractPayload(orgA, 'overflow'), { orgBatchLimit: 5 });
      }),
    ).rejects.toMatchObject({ code: 'concurrency_limit' });

    await runWithCorrelationIdAsync('cor-gate-3', async () => {
      await enqueue.enqueue('extract', extractPayload(orgB, 'b-1'), { orgBatchLimit: 5 });
    });

    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue('extract', { connection });
    expect(await queue.getWaitingCount()).toBeGreaterThan(0);

    await queue.close();
    await connection.quit();
    await adapter.disconnect('dhb42');
    await counter.disconnect('dhb42');
    await moduleRef.close();
    await stop();
  });
});
