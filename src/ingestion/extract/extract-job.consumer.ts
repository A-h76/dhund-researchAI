import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  DOCUMENT_INGESTION_STORE,
  type DocumentIngestionStore,
} from '../../l0/ports/document-ingestion.port';
import type { QueueService, QueueWorkerHandle } from '../../l0/ports/queue.port';
import { QUEUE_SERVICE } from '../../l0/ports/tokens';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidJobPayload } from '../../platform/logging/job-payload';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { EXTRACTOR_VERSION } from './extract.constants';
import { isExtractError } from './extract.errors';
import { ExtractService, type ExtractJobPayload } from './extract.service';

@Injectable()
export class ExtractJobConsumer implements OnModuleDestroy {
  private handle: QueueWorkerHandle | null = null;

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    @Inject(DOCUMENT_INGESTION_STORE) private readonly store: DocumentIngestionStore,
    private readonly extractService: ExtractService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
    private readonly logger: PlatformLogger,
  ) {}

  async start(): Promise<void> {
    if (this.handle !== null) {
      return;
    }

    const policy = getQueueLivenessPolicy('extract');
    this.handle = await this.queueService.processJobs('extract', async (job) => {
      assertValidJobPayload(job.data);
      assertValidQueuePayload('extract', job.data);

      const payload = toExtractPayload(job.data);
      await runWithCorrelationIdAsync(payload.correlationId, async () => {
        await this.heartbeat.startJob({
          queue: 'extract',
          jobId: job.id,
          orgId: payload.orgId,
          correlationId: payload.correlationId,
          payload: job.data,
        });

        const heartbeatTimer = setInterval(() => {
          void this.heartbeat.renew({ queue: 'extract', jobId: job.id });
        }, policy.heartbeatIntervalMs);

        try {
          await this.extractService.execute(payload, {
            onHeartbeat: async () => {
              await this.heartbeat.renew({ queue: 'extract', jobId: job.id });
            },
          });
          await this.heartbeat.complete({ queue: 'extract', jobId: job.id });
        } catch (error) {
          const extractError = isExtractError(error) ? error : null;
          const recoverable = extractError?.recoverable ?? true;
          const exhausted = job.attemptsMade + 1 >= job.attempts;

          if (!recoverable || exhausted) {
            await this.markDocumentFailed(payload.documentVersionId);
            await this.dlq.routeExhaustedJob({
              queueName: 'extract',
              jobId: job.id,
              payload: job.data,
              errorMessage: error instanceof Error ? error.message : String(error),
              attemptCount: job.attemptsMade + 1,
            });
            await this.heartbeat.complete({ queue: 'extract', jobId: job.id });
            this.logger.error({
              module: 'ingestion',
              message: 'extract.failed',
              jobId: job.id,
              documentVersionId: payload.documentVersionId,
              recoverable,
              exhausted,
              error: error instanceof Error ? error.message : String(error),
            });
            if (!recoverable) {
              return;
            }
          } else {
            await this.heartbeat.complete({ queue: 'extract', jobId: job.id });
          }

          throw error;
        } finally {
          clearInterval(heartbeatTimer);
        }
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.handle !== null) {
      await this.handle.close();
      this.handle = null;
    }
  }

  private async markDocumentFailed(documentVersionId: string): Promise<void> {
    try {
      const version = await this.store.getVersionWithDocument(documentVersionId);
      if (version !== null && version.document.status !== 'failed') {
        await this.store.markDocumentStatus(version.documentId, 'failed');
      }
    } catch {
      // best-effort status honesty on terminal failure
    }
  }
}

function toExtractPayload(data: Record<string, unknown>): ExtractJobPayload {
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    documentVersionId: String(data.documentVersionId),
    contentHash: String(data.contentHash),
    extractorVersion: String(data.extractorVersion ?? EXTRACTOR_VERSION),
    correlationId: String(data.correlationId),
  };
}
