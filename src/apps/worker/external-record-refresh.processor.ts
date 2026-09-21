import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import {
  ExternalRecordRefreshService,
  type ExternalRecordRefreshJobPayload,
} from '../../external-records/external-record-refresh.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class ExternalRecordRefreshProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly refresh: ExternalRecordRefreshService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('external-record-refresh');
    await this.queue.consume('external-record-refresh', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('external-record-refresh', job.data);
    const payload = toPayload(job.data);
    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'external-record-refresh',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });
      const intervalMs = getQueueLivenessPolicy('external-record-refresh').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'external-record-refresh', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.refresh.execute(payload);
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'external-record-refresh',
            jobId: job.id,
            payload: job.data,
            errorMessage:
              error instanceof Error ? error.message : 'external-record-refresh failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        throw error;
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({
          queue: 'external-record-refresh',
          jobId: job.id,
        });
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): ExternalRecordRefreshJobPayload {
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    correlationId: String(data.correlationId),
    externalRecordId: String(data.externalRecordId),
    refreshInstant: String(data.refreshInstant),
    ...(data.includeBody === true ? { includeBody: true } : {}),
  };
}
