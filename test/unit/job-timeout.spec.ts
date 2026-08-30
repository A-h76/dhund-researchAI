import { JobTimeoutService } from '../../src/platform/reliability/job-timeout.service';
import type { QueueService } from '../../src/l0/ports';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

describe('job timeout service (DHB-41, GAP-TIMEOUT-01)', () => {
  it('retries failed jobs using the queue policy rather than a global default', async () => {
    const calls: Array<{ queue: string; jobId: string }> = [];
    const queue: QueueService = {
      connect: async () => undefined,
      disconnect: async () => undefined,
      ping: async () => true,
      addJob: async (queueName, _data, options) => {
        calls.push({ queue: queueName, jobId: options.jobId });
        return options.jobId;
      },
      addDlqJob: async () => 'dlq',
      getJobState: async () => 'active',
      retryFailedJob: async () => 'noop',
      getQueueDepth: async () => ({ waiting: 0, active: 0, failed: 0, delayed: 0 }),
    };
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as PlatformLogger;

    const service = new JobTimeoutService(queue, logger);
    const action = await service.enforceTimeout(
      {
        queue: 'billing-sync',
        jobId: 'job-timeout-1',
        orgId: 'org-1',
        correlationId: 'cor-timeout-1',
        startedAtMs: Date.now() - 900_000,
        lastHeartbeatAtMs: Date.now() - 900_000,
        payload: {
          orgId: 'org-1',
          correlationId: 'cor-timeout-1',
          stripeEventId: 'evt_1',
        },
      },
      Date.now(),
    );

    expect(action).toBe('redriven');
    expect(calls).toEqual([{ queue: 'billing-sync', jobId: 'job-timeout-1' }]);
  });
});
