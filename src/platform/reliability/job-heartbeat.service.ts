import { Injectable } from '@nestjs/common';
import type { QueueName } from '../queues/queue-names';
import { PlatformLogger } from '../logging/platform-logger.service';
import { getQueueLivenessPolicy } from './queue-liveness.config';
import { RedisJobLivenessStore } from './redis-job-liveness.store';
import { LeasedSemaphoreService } from './leased-semaphore.service';
import type { JobLivenessRecord } from './job-liveness.types';
import { ReliabilityMetrics } from './reliability-metrics';

@Injectable()
export class JobHeartbeatService {
  constructor(
    private readonly livenessStore: RedisJobLivenessStore,
    private readonly semaphore: LeasedSemaphoreService,
    private readonly logger: PlatformLogger,
    private readonly metrics: ReliabilityMetrics,
  ) {}

  async startJob(input: {
    queue: QueueName;
    jobId: string;
    orgId: string;
    correlationId: string;
    payload: Record<string, unknown>;
    stepType?: string;
    startedAtMs?: number;
  }): Promise<void> {
    const nowMs = input.startedAtMs ?? Date.now();
    const policy = getQueueLivenessPolicy(input.queue);
    const record: JobLivenessRecord = {
      queue: input.queue,
      jobId: input.jobId,
      orgId: input.orgId,
      correlationId: input.correlationId,
      startedAtMs: nowMs,
      lastHeartbeatAtMs: nowMs,
      ...(input.stepType !== undefined ? { stepType: input.stepType } : {}),
      payload: input.payload,
    };

    await this.livenessStore.register(record);
    await this.semaphore.acquire(
      this.semaphore.buildJobLeaseKey(input.queue, input.jobId),
      input.jobId,
      policy.leaseTtlSeconds,
    );
  }

  async renew(input: {
    queue: QueueName;
    jobId: string;
    atMs?: number;
  }): Promise<boolean> {
    const atMs = input.atMs ?? Date.now();
    const record = await this.livenessStore.heartbeat(input.queue, input.jobId, atMs);
    if (record === null) {
      return false;
    }

    const policy = getQueueLivenessPolicy(input.queue);
    const renewed = await this.semaphore.renewHeartbeat(
      this.semaphore.buildJobLeaseKey(input.queue, input.jobId),
      input.jobId,
      policy.leaseTtlSeconds,
    );

    if (renewed) {
      this.metrics.recordHeartbeatRenewal();
      this.logger.debug({
        module: 'reliability',
        message: 'job.heartbeat.renewed',
        queue: input.queue,
        jobId: input.jobId,
      });
    }

    return renewed;
  }

  async complete(input: { queue: QueueName; jobId: string }): Promise<void> {
    await this.semaphore.release(
      this.semaphore.buildJobLeaseKey(input.queue, input.jobId),
      input.jobId,
    );
    await this.livenessStore.remove(input.queue, input.jobId);
  }
}
