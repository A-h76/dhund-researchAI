import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import { EmbedUnrecoverableError, EmbedService } from '../../ai/embed/embed.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { DlqService } from '../../platform/queues/dlq.service';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class EmbedProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly embed: EmbedService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('embed');
    await this.queue.consume('embed', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('embed', job.data);
    const payload = job.data;
    const chunkId = String(payload.chunkId);
    await runWithCorrelationIdAsync(String(payload.correlationId), async () => {
      await this.heartbeat.startJob({
        queue: 'embed',
        jobId: job.id,
        orgId: String(payload.orgId),
        correlationId: String(payload.correlationId),
        payload,
      });
      const intervalMs = getQueueLivenessPolicy('embed').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'embed', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.embed.run({
          orgId: String(payload.orgId),
          projectId: String(payload.projectId),
          chunkId,
          modelVersion: String(payload.modelVersion),
          contentHash: String(payload.contentHash),
          onProgress: async () => {
            await this.heartbeat.renew({ queue: 'embed', jobId: job.id });
          },
        });
      } catch (error) {
        const unrecoverable = error instanceof EmbedUnrecoverableError;
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (unrecoverable || exhausted) {
          // A chunk that never embeds leaves the document incomplete for
          // retrieval, so consumers must refuse it with document_not_ready.
          await this.embed.markDocumentPartial(chunkId);
          await this.dlq.routeExhaustedJob({
            queueName: 'embed',
            jobId: job.id,
            payload,
            errorMessage: error instanceof Error ? error.message : 'embed failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        if (!unrecoverable) {
          throw error;
        }
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'embed', jobId: job.id });
      }
    });
  }
}
