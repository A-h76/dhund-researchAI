import { ReaperService } from '../../src/platform/reliability/reaper.service';
import {
  InMemoryJobLivenessStore,
  ReliabilityMetrics,
  ReaperCoordinationService,
  LeasedSemaphoreService,
} from '../../src/platform/reliability';
import { JobTimeoutService } from '../../src/platform/reliability/job-timeout.service';
import type { LeaseService, QueueService } from '../../src/l0/ports';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';
import { deriveJobId } from '../../src/platform/queues';

describe('reaper service (DHB-41)', () => {
  const holders = new Map<string, string>();
  const redriven: string[] = [];

  const lease: LeaseService = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    tryAcquire: async (_scope, key, holderId) => {
      const current = holders.get(key);
      if (current === undefined) {
        holders.set(key, holderId);
        return 'acquired';
      }
      if (current === holderId) {
        return 'renewed';
      }
      return 'contended';
    },
    renew: async (_scope, key, holderId) => holders.get(key) === holderId,
    release: async (_scope, key, holderId) => {
      if (holders.get(key) !== holderId) {
        return false;
      }
      holders.delete(key);
      return true;
    },
    getHolder: async (_scope, key) => holders.get(key) ?? null,
  };

  const queue: QueueService = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    addJob: async (_queueName, _data, options) => {
      redriven.push(options.jobId);
      return options.jobId;
    },
    addDlqJob: async () => 'dlq',
    getJobState: async () => 'failed',
    retryFailedJob: async () => 'retried',
    getQueueDepth: async () => ({ waiting: 0, active: 0, failed: 0, delayed: 0 }),
    consume: async () => undefined,
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  } as unknown as PlatformLogger;

  function buildReaper(store: InMemoryJobLivenessStore): ReaperService {
    const metrics = new ReliabilityMetrics();
    const coordination = new ReaperCoordinationService(lease);
    const semaphore = new LeasedSemaphoreService(lease);
    const timeoutService = new JobTimeoutService(queue, logger);

    return new ReaperService(
      queue,
      store as never,
      semaphore,
      coordination,
      timeoutService,
      metrics,
      logger,
    );
  }

  beforeEach(() => {
    holders.clear();
    redriven.length = 0;
  });

  it('re-drives stale jobs with the same jobId after worker crash', async () => {
    const store = new InMemoryJobLivenessStore();
    const payload = {
      orgId: 'org-1',
      correlationId: 'cor-1',
      projectId: 'proj-1',
      documentVersionId: 'dv-1',
      contentHash: 'hash-1',
      extractorVersion: 'v1',
    };
    const jobId = deriveJobId('extract', payload);
    const now = Date.now();

    await store.register({
      queue: 'extract',
      jobId,
      orgId: 'org-1',
      correlationId: 'cor-1',
      startedAtMs: now - 120_000,
      lastHeartbeatAtMs: now - 120_000,
      payload,
    });

    const reaper = buildReaper(store);
    const result = await reaper.executeTick(new Date(now).toISOString(), 'reaper-a');

    expect(result.recovered).toBe(1);
    expect(redriven).toEqual([jobId]);
  });

  it('does not reap a long job that is still heartbeating', async () => {
    const store = new InMemoryJobLivenessStore();
    const payload = {
      orgId: 'org-1',
      correlationId: 'cor-2',
      projectId: 'proj-1',
      documentVersionId: 'dv-2',
      chunkerVersion: 'v1',
      contentHash: 'hash-2',
    };
    const jobId = deriveJobId('chunk', payload);
    const now = Date.now();

    await store.register({
      queue: 'chunk',
      jobId,
      orgId: 'org-1',
      correlationId: 'cor-2',
      startedAtMs: now - 3_000_000,
      lastHeartbeatAtMs: now - 5_000,
      payload,
    });

    const reaper = buildReaper(store);
    const result = await reaper.executeTick(new Date(now).toISOString(), 'reaper-a');

    expect(result.recovered).toBe(0);
    expect(redriven).toEqual([]);
    expect(result.skippedHealthy).toBe(1);
  });

  it('does not reap an extract job that heartbeats within the 10 minute timeout', async () => {
    const store = new InMemoryJobLivenessStore();
    const payload = {
      orgId: 'org-1',
      correlationId: 'cor-extract-live',
      projectId: 'proj-1',
      documentVersionId: 'dv-extract',
      contentHash: 'hash-extract',
      extractorVersion: 'v1',
    };
    const jobId = deriveJobId('extract', payload);
    const now = Date.now();

    await store.register({
      queue: 'extract',
      jobId,
      orgId: 'org-1',
      correlationId: 'cor-extract-live',
      startedAtMs: now - 120_000,
      lastHeartbeatAtMs: now - 5_000,
      payload,
    });

    const reaper = buildReaper(store);
    const result = await reaper.executeTick(new Date(now).toISOString(), 'reaper-a');

    expect(result.recovered).toBe(0);
    expect(result.timedOut).toBe(0);
    expect(redriven).toEqual([]);
    expect(result.skippedHealthy).toBe(1);
  });

  it('no-ops duplicate reaper ticks via per-tick idempotency', async () => {
    const store = new InMemoryJobLivenessStore();
    const payload = {
      orgId: 'org-1',
      correlationId: 'cor-3',
      projectId: 'proj-1',
      runId: 'run-1',
      evidenceId: 'ev-1',
    };
    const jobId = deriveJobId('stance', payload);
    const now = Date.now();

    await store.register({
      queue: 'stance',
      jobId,
      orgId: 'org-1',
      correlationId: 'cor-3',
      startedAtMs: now - 120_000,
      lastHeartbeatAtMs: now - 120_000,
      payload,
    });

    const reaper = buildReaper(store);
    const tick = new Date(now).toISOString();
    const first = await reaper.executeTick(tick, 'reaper-a');
    const second = await reaper.executeTick(tick, 'reaper-b');

    expect(first.recovered).toBe(1);
    expect(second.recovered).toBe(0);
    expect(redriven).toEqual([jobId]);
  });
});
