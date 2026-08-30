import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { runWithCorrelationIdAsync } from '../logging/correlation-context';
import { PlatformLogger } from '../logging/platform-logger.service';
import { getQueuePolicy, resolveAttempts } from '../queues/queue-registry';
import type { JobLivenessRecord } from './job-liveness.types';
import { getQueueLivenessPolicy } from './queue-liveness.config';
import { hasExceededQueueTimeout } from './stalled-threshold';

export type TimeoutAction = 'retried' | 'noop' | 'redriven';

@Injectable()
export class JobTimeoutService {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    private readonly logger: PlatformLogger,
  ) {}

  async enforceTimeout(
    record: JobLivenessRecord,
    nowMs: number = Date.now(),
  ): Promise<TimeoutAction> {
    const policy = getQueueLivenessPolicy(record.queue);
    if (!hasExceededQueueTimeout(record.startedAtMs, nowMs, policy)) {
      return 'noop';
    }

    const queuePolicy = getQueuePolicy(record.queue);
    const attempts = resolveAttempts(queuePolicy, record.stepType);
    const state = await this.queueService.getJobState(record.queue, record.jobId);

    this.logger.warn({
      module: 'reliability',
      message: 'job.timeout.exceeded',
      queue: record.queue,
      jobId: record.jobId,
      timeoutMs: policy.timeoutMs,
      attempts,
      state,
    });

    if (state === 'failed') {
      const retried = await this.queueService.retryFailedJob(record.queue, record.jobId);
      return retried === 'retried' ? 'retried' : 'noop';
    }

    await this.redrive(record, attempts, queuePolicy.backoff);
    return 'redriven';
  }

  private async redrive(
    record: JobLivenessRecord,
    attempts: number | undefined,
    backoff: { type: 'exponential'; delayMs: number } | null,
  ): Promise<void> {
    await runWithCorrelationIdAsync(record.correlationId, async () => {
      await this.queueService.addJob(record.queue, record.payload, {
        jobId: record.jobId,
        ...(attempts !== undefined ? { attempts } : {}),
        ...(backoff !== null ? { backoff } : {}),
      });
    });
  }
}
