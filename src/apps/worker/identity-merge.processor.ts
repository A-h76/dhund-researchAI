import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import {
  IdentityMergeService,
  type IdentityMergeJobPayload,
} from '../../identity/identity-merge.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class IdentityMergeProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly merge: IdentityMergeService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('identity-merge');
    await this.queue.consume('identity-merge', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('identity-merge', job.data);
    const payload = toPayload(job.data);
    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'identity-merge',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });
      const intervalMs = getQueueLivenessPolicy('identity-merge').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'identity-merge', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.merge.execute(payload);
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'identity-merge',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : 'identity-merge failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        throw error;
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'identity-merge', jobId: job.id });
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): IdentityMergeJobPayload {
  const decision = data.decision === 'reject' ? 'reject' : 'approve';
  return {
    orgId: String(data.orgId),
    correlationId: String(data.correlationId),
    mergeCandidateId: String(data.mergeCandidateId),
    decision,
    reviewedBy: String(data.reviewedBy ?? data.orgId),
  };
}
