import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import { ExtractUnrecoverableError, ExtractService } from '../../ingestion/extract.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { DlqService } from '../../platform/queues/dlq.service';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class ExtractProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly extract: ExtractService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('extract');
    await this.queue.consume('extract', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('extract', job.data);
    const payload = job.data;
    const documentVersionId = String(payload.documentVersionId);
    await runWithCorrelationIdAsync(String(payload.correlationId), async () => {
      await this.heartbeat.startJob({
        queue: 'extract',
        jobId: job.id,
        orgId: String(payload.orgId),
        correlationId: String(payload.correlationId),
        payload,
      });
      const intervalMs = getQueueLivenessPolicy('extract').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'extract', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.extract.run({
          orgId: String(payload.orgId),
          projectId: String(payload.projectId),
          documentVersionId,
          contentHash: String(payload.contentHash),
          extractorVersion: String(payload.extractorVersion),
          onProgress: async () => {
            await this.heartbeat.renew({ queue: 'extract', jobId: job.id });
          },
        });
      } catch (error) {
        const unrecoverable = error instanceof ExtractUnrecoverableError;
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (unrecoverable || exhausted) {
          await this.extract.failDocument(documentVersionId);
          await this.dlq.routeExhaustedJob({
            queueName: 'extract',
            jobId: job.id,
            payload,
            errorMessage: error instanceof Error ? error.message : 'extract failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        if (!unrecoverable) {
          throw error;
        }
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'extract', jobId: job.id });
      }
    });
  }
}
