import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import { EmbedBackfillService } from '../../ai/embed/embed-backfill.service';
import { EmbedBackfillPayloadError } from '../../ai/embed/embed-backfill.payload';
import { EmbedUnrecoverableError } from '../../ai/embed/embed.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { DlqService } from '../../platform/queues/dlq.service';
import { ProcessorRegistry } from './processor-registry';

/**
 * Operator-only queue (GAP-ADMIN-JOB-01). Unlike embed, a backfill failure never
 * degrades a document: it targets a version that is not yet write-active.
 */
@Injectable()
export class EmbedBackfillProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly backfill: EmbedBackfillService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('embed-backfill');
    await this.queue.consume('embed-backfill', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('embed-backfill', job.data);
    const payload = job.data;
    await runWithCorrelationIdAsync(String(payload.correlationId), async () => {
      await this.heartbeat.startJob({
        queue: 'embed-backfill',
        jobId: job.id,
        orgId: String(payload.orgId),
        correlationId: String(payload.correlationId),
        payload,
      });
      const intervalMs = getQueueLivenessPolicy('embed-backfill').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'embed-backfill', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.backfill.run({
          payload,
          onProgress: async () => {
            await this.heartbeat.renew({ queue: 'embed-backfill', jobId: job.id });
          },
        });
      } catch (error) {
        const unrecoverable =
          error instanceof EmbedUnrecoverableError ||
          error instanceof EmbedBackfillPayloadError;
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (unrecoverable || exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'embed-backfill',
            jobId: job.id,
            payload,
            errorMessage: error instanceof Error ? error.message : 'embed-backfill failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        if (!unrecoverable) {
          throw error;
        }
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'embed-backfill', jobId: job.id });
      }
    });
  }
}
