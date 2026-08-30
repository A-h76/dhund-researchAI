import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { runWithCorrelationIdAsync } from '../logging/correlation-context';
import { PlatformLogger } from '../logging/platform-logger.service';
import { getQueuePolicy, resolveAttempts } from '../queues/queue-registry';
import { JobTimeoutService } from './job-timeout.service';
import { RedisJobLivenessStore } from './redis-job-liveness.store';
import { LeasedSemaphoreService } from './leased-semaphore.service';
import { getQueueLivenessPolicy } from './queue-liveness.config';
import { ReaperCoordinationService } from './reaper-coordination.service';
import { ReliabilityMetrics } from './reliability-metrics';
import {
  computeStalledThresholdMs,
  hasExceededQueueTimeout,
  isHeartbeatStale,
} from './stalled-threshold';
import type { JobLivenessRecord } from './job-liveness.types';

export interface ReaperTickResult {
  readonly tickBucket: string;
  readonly recovered: number;
  readonly timedOut: number;
  readonly skippedHealthy: number;
  readonly skippedRace: number;
}

@Injectable()
export class ReaperService {
  private readonly stepDurationWindows = new Map<string, number[]>();

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    private readonly livenessStore: RedisJobLivenessStore,
    private readonly semaphore: LeasedSemaphoreService,
    private readonly coordination: ReaperCoordinationService,
    private readonly timeoutService: JobTimeoutService,
    private readonly metrics: ReliabilityMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  recordStepDuration(stepType: string, durationMs: number): void {
    const window = this.stepDurationWindows.get(stepType) ?? [];
    window.push(durationMs);
    if (window.length > 20) {
      window.shift();
    }
    this.stepDurationWindows.set(stepType, window);
  }

  async executeTick(tickBucket: string, holderId: string): Promise<ReaperTickResult> {
    const tickClaim = await this.coordination.tryClaimTick(tickBucket, holderId);
    if (tickClaim === 'noop') {
      return {
        tickBucket,
        recovered: 0,
        timedOut: 0,
        skippedHealthy: 0,
        skippedRace: 0,
      };
    }

    const nowMs = Date.now();
    const active = await this.livenessStore.listActive();
    let recovered = 0;
    let timedOut = 0;
    let skippedHealthy = 0;
    let skippedRace = 0;

    for (const record of active) {
      if (record.queue === 'reaper') {
        continue;
      }

      const policy = getQueueLivenessPolicy(record.queue);
      const stalledThresholdMs = computeStalledThresholdMs({
        stepType: record.stepType,
        recentDurationsMs: this.stepDurationWindow(record.stepType),
      });

      const heartbeatFresh = !isHeartbeatStale(
        record.lastHeartbeatAtMs,
        nowMs,
        policy,
        stalledThresholdMs,
      );

      if (heartbeatFresh) {
        if (hasExceededQueueTimeout(record.startedAtMs, nowMs, policy)) {
          const action = await this.timeoutService.enforceTimeout(record, nowMs);
          if (action !== 'noop') {
            timedOut += 1;
          }
        } else {
          skippedHealthy += 1;
        }
        continue;
      }

      const leaseHolder = await this.semaphore.getHolder(
        this.semaphore.buildJobLeaseKey(record.queue, record.jobId),
      );
      if (leaseHolder !== null && leaseHolder === record.jobId) {
        this.metrics.recordLeaseExpiry();
      }

      const claim = await this.coordination.withAdvisoryLock(
        `recover:${record.queue}:${record.jobId}`,
        async () =>
          this.coordination.tryClaimRecovery(record.queue, record.jobId, holderId),
      );

      if (claim === 'noop') {
        skippedRace += 1;
        continue;
      }

      try {
        const redriven = await this.redriveJob(record);
        if (redriven) {
          recovered += 1;
          this.metrics.recordReaperReclaim();
          this.metrics.recordStalledJob();
        }
      } finally {
        await this.coordination.releaseRecoveryClaim(record.queue, record.jobId, holderId);
      }
    }

    this.logger.info({
      module: 'reliability',
      message: 'reaper.tick.completed',
      tickBucket,
      recovered,
      timedOut,
      skippedHealthy,
      skippedRace,
    });

    return { tickBucket, recovered, timedOut, skippedHealthy, skippedRace };
  }

  private stepDurationWindow(stepType?: string): readonly number[] {
    if (stepType === undefined) {
      return [];
    }
    return this.stepDurationWindows.get(stepType) ?? [];
  }

  private async redriveJob(record: JobLivenessRecord): Promise<boolean> {
    const queuePolicy = getQueuePolicy(record.queue);
    const attempts = resolveAttempts(queuePolicy, record.stepType);

    await runWithCorrelationIdAsync(record.correlationId, async () => {
      await this.queueService.addJob(record.queue, record.payload, {
        jobId: record.jobId,
        ...(attempts !== undefined ? { attempts } : {}),
        ...(queuePolicy.backoff !== null ? { backoff: queuePolicy.backoff } : {}),
      });
    });

    record.lastHeartbeatAtMs = Date.now();
    await this.livenessStore.register(record);
    await this.semaphore.acquire(
      this.semaphore.buildJobLeaseKey(record.queue, record.jobId),
      record.jobId,
      getQueueLivenessPolicy(record.queue).leaseTtlSeconds,
    );

    this.logger.warn({
      module: 'reliability',
      message: 'reaper.job.redriven',
      queue: record.queue,
      jobId: record.jobId,
    });

    return true;
  }
}
