import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import { ChunkUnrecoverableError, ChunkService } from '../../ingestion/chunk.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { DlqService } from '../../platform/queues/dlq.service';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class ChunkProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly chunk: ChunkService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('chunk');
    await this.queue.consume('chunk', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('chunk', job.data);
    const payload = job.data;
    const documentVersionId = String(payload.documentVersionId);
    await runWithCorrelationIdAsync(String(payload.correlationId), async () => {
      await this.heartbeat.startJob({
        queue: 'chunk',
        jobId: job.id,
        orgId: String(payload.orgId),
        correlationId: String(payload.correlationId),
        payload,
      });
      const intervalMs = getQueueLivenessPolicy('chunk').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'chunk', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.chunk.run({
          orgId: String(payload.orgId),
          projectId: String(payload.projectId),
          documentVersionId,
          chunkerVersion: String(payload.chunkerVersion),
          contentHash: String(payload.contentHash),
          onProgress: async () => {
            await this.heartbeat.renew({ queue: 'chunk', jobId: job.id });
          },
        });
      } catch (error) {
        const unrecoverable = error instanceof ChunkUnrecoverableError;
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (unrecoverable || exhausted) {
          await this.chunk.failDocument(documentVersionId);
          await this.dlq.routeExhaustedJob({
            queueName: 'chunk',
            jobId: job.id,
            payload,
            errorMessage: error instanceof Error ? error.message : 'chunk failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        if (!unrecoverable) {
          throw error;
        }
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'chunk', jobId: job.id });
      }
    });
  }
}
