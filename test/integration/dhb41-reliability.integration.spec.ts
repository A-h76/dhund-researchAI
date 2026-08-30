import { GenericContainer, Wait } from 'testcontainers';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import { BullmqQueueAdapter } from '../../src/l0/adapters/bullmq/bullmq-queue.adapter';
import { RedisLeaseAdapter } from '../../src/l0/adapters/redis/redis-lease.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { CACHE_SERVICE, LEASE_SERVICE, QUEUE_SERVICE } from '../../src/l0/ports';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import {
  JobHeartbeatService,
  LeasedSemaphoreService,
  ReaperCoordinationService,
  ReaperService,
  ReliabilityMetrics,
  ReliabilityModule,
} from '../../src/platform/reliability';
import { JobTimeoutService } from '../../src/platform/reliability/job-timeout.service';
import { RedisJobLivenessStore } from '../../src/platform/reliability/redis-job-liveness.store';
import { LoggerModule } from '../../src/platform/logging/logger.module';
import { QueuesModule } from '../../src/platform/queues/queues.module';
import { deriveJobId } from '../../src/platform/queues';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(integrationEnabled ? describe : describe.skip)('DHB-41 reliability (integration)', () => {
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

  it('renews heartbeat leases and releases them when the recovering process stops', async () => {
    const { redisUrl, stop } = await startRedis();
    installTestAppConfig({ redisUrl, logLevel: 'silent' });

    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl,
      databasePoolSize: 10,
    };

    const cache = new RedisCacheAdapter(connectionConfig);
    const lease = new RedisLeaseAdapter(connectionConfig);
    await cache.connect('dhb41');
    await lease.connect('dhb41');

    const semaphore = new LeasedSemaphoreService(lease);
    const key = semaphore.buildJobLeaseKey('extract', 'job-lease-1');
    expect(await semaphore.acquire(key, 'job-lease-1', 2)).toBe('acquired');
    expect(await semaphore.renewHeartbeat(key, 'job-lease-1', 2)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(await semaphore.getHolder(key)).toBeNull();

    await cache.disconnect('dhb41');
    await lease.disconnect('dhb41');
    await stop();
  });

  it('re-drives stale work through Redis-backed liveness with the same jobId', async () => {
    const { redisUrl, stop } = await startRedis();
    installTestAppConfig({ redisUrl, logLevel: 'silent' });

    const connectionConfig: L0ConnectionConfig = {
      databaseUrl: 'postgres://localhost:5432/dhund',
      redisUrl,
      databasePoolSize: 10,
    };

    const adapter = new BullmqQueueAdapter(connectionConfig);
    const cache = new RedisCacheAdapter(connectionConfig);
    const lease = new RedisLeaseAdapter(connectionConfig);
    await adapter.connect('dhb41');
    await cache.connect('dhb41');
    await lease.connect('dhb41');

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, QueuesModule, ReliabilityModule],
    })
      .overrideProvider(QUEUE_SERVICE)
      .useValue(adapter)
      .overrideProvider(CACHE_SERVICE)
      .useValue(cache)
      .overrideProvider(LEASE_SERVICE)
      .useValue(lease)
      .compile();

    const heartbeat = moduleRef.get(JobHeartbeatService);
    const metrics = moduleRef.get(ReliabilityMetrics);
    const logger = moduleRef.get(PlatformLogger);

    const payload = {
      orgId: 'org-int-1',
      correlationId: 'cor-int-1',
      projectId: 'proj-int-1',
      documentVersionId: 'dv-int-1',
      contentHash: 'hash-int-1',
      extractorVersion: 'ext-v1',
    };
    const jobId = deriveJobId('extract', payload);
    const staleStartedAt = Date.now() - 120_000;

    await heartbeat.startJob({
      queue: 'extract',
      jobId,
      orgId: 'org-int-1',
      correlationId: 'cor-int-1',
      payload,
      startedAtMs: staleStartedAt,
    });

    const store = moduleRef.get(RedisJobLivenessStore);
    await store.heartbeat('extract', jobId, staleStartedAt);

    const coordination = moduleRef.get(ReaperCoordinationService);
    const timeoutService = moduleRef.get(JobTimeoutService);
    const semaphore = moduleRef.get(LeasedSemaphoreService);
    const directReaper = new ReaperService(
      adapter,
      store,
      semaphore,
      coordination,
      timeoutService,
      metrics,
      logger,
    );

    const tick = new Date().toISOString();
    const result = await directReaper.executeTick(tick, 'reaper-int');

    expect(result.recovered).toBe(1);
    expect(await adapter.getJobState('extract', jobId)).not.toBeNull();

    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    await connection.quit();
    await adapter.disconnect('dhb41');
    await cache.disconnect('dhb41');
    await lease.disconnect('dhb41');
    await moduleRef.close();
    await stop();
  });
});
