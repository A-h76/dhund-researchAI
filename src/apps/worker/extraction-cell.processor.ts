import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  QUEUE_SERVICE,
  type QueueJob,
  type QueueService,
} from '../../l0/ports';
import {
  ExtractionCellService,
  type ExtractionCellJobPayload,
} from '../../orchestration/extraction-cell.service';
import { DomainError, ErrorCode } from '../../platform/errors';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidJobPayload } from '../../platform/logging/job-payload';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class ExtractionCellProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly cells: ExtractionCellService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
    private readonly logger: PlatformLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('extraction-cell');
    await this.queue.consume('extraction-cell', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidJobPayload(job.data);
    assertValidQueuePayload('extraction-cell', job.data);
    const payload = toPayload(job.data);

    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'extraction-cell',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });

      const intervalMs = getQueueLivenessPolicy('extraction-cell').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'extraction-cell', jobId: job.id });
      }, intervalMs);
      timer.unref();

      try {
        await this.cells.execute(payload);
        await this.heartbeat.complete({
          queue: 'extraction-cell',
          jobId: job.id,
        });
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        const nonRetryable =
          error instanceof DomainError &&
          (error.code === ErrorCode.DocumentNotReady ||
            error.code === ErrorCode.NotFound ||
            error.code === ErrorCode.ExtractionValueTypeMismatch);

        if (exhausted || nonRetryable) {
          await this.dlq.routeExhaustedJob({
            queueName: 'extraction-cell',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : String(error),
            attemptCount: job.attemptsMade + 1,
          });
          await this.heartbeat.complete({
            queue: 'extraction-cell',
            jobId: job.id,
          });
          this.logger.error({
            module: 'orchestration',
            message: 'extraction-cell.failed',
            jobId: job.id,
            extractionRunId: payload.extractionRunId,
            documentId: payload.documentId,
            columnKey: payload.columnKey,
            exhausted,
            nonRetryable,
            error: error instanceof Error ? error.message : String(error),
          });
          if (nonRetryable) {
            return;
          }
          return;
        }
        await this.heartbeat.complete({
          queue: 'extraction-cell',
          jobId: job.id,
        });
        throw error;
      } finally {
        clearInterval(timer);
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): ExtractionCellJobPayload {
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    runId: String(data.runId),
    extractionRunId: String(data.extractionRunId),
    documentId: String(data.documentId),
    columnKey: String(data.columnKey),
    correlationId: String(data.correlationId),
  };
}
