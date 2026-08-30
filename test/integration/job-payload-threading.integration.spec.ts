import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import { GenericContainer, Wait } from 'testcontainers';
import { BullmqQueueAdapter } from '../../src/l0/adapters/bullmq/bullmq-queue.adapter';
import { QUEUE_SERVICE } from '../../src/l0/ports';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { runWithCorrelationId } from '../../src/platform/logging/correlation-context';
import { JobEnqueueService } from '../../src/platform/logging/job-enqueue.service';
import { assertValidJobPayload } from '../../src/platform/logging/job-payload';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(integrationEnabled ? describe : describe.skip)(
  'job payload threading (integration)',
  () => {
    jest.setTimeout(180_000);

    it('enqueues a payload carrying the same correlationId from ALS', async () => {
      const redis = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
        .start();

      const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
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
      await adapter.connect('integration-correlation');

      const moduleRef = await Test.createTestingModule({
        imports: [LoggerModule],
      })
        .overrideProvider(QUEUE_SERVICE)
        .useValue(adapter)
        .compile();

      const enqueue = moduleRef.get(JobEnqueueService);
      const correlationId = 'cor-integration-thread-1';
      let jobId = '';

      await runWithCorrelationId(correlationId, async () => {
        jobId = await enqueue.enqueue('billing-sync', {
          orgId: 'org-integration-1',
          stripeEventId: 'evt_integration_1',
        });
      });

      const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
      const queue = new Queue('billing-sync', { connection });
      const job = await queue.getJob(jobId);

      expect(job).toBeDefined();
      assertValidJobPayload(job?.data);
      expect(job?.data).toEqual({
        correlationId,
        orgId: 'org-integration-1',
        stripeEventId: 'evt_integration_1',
      });

      await queue.close();
      await connection.quit();
      await adapter.disconnect('integration-correlation');
      await moduleRef.close();
      await redis.stop();
    });
  },
);
