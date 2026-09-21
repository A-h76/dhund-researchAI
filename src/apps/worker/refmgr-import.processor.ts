import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import {
  RefmgrImportService,
  type RefmgrImportItem,
  type RefmgrImportJobPayload,
} from '../../external-records/refmgr-import.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class RefmgrImportProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly importer: RefmgrImportService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('refmgr-import');
    await this.queue.consume('refmgr-import', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('refmgr-import', job.data);
    const payload = toPayload(job.data);
    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'refmgr-import',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });
      const intervalMs = getQueueLivenessPolicy('refmgr-import').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'refmgr-import', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.importer.execute(payload);
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'refmgr-import',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : 'refmgr-import failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        throw error;
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'refmgr-import', jobId: job.id });
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): RefmgrImportJobPayload {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    correlationId: String(data.correlationId),
    importSessionId: String(data.importSessionId),
    items: items.map(toItem),
  };
}

function toItem(raw: unknown): RefmgrImportItem {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    externalId: String(row.externalId ?? ''),
    title: String(row.title ?? ''),
    ...(Array.isArray(row.authors)
      ? { authors: row.authors.map((author) => String(author)) }
      : {}),
    ...(typeof row.year === 'number' ? { year: row.year } : {}),
    ...(typeof row.doi === 'string' ? { doi: row.doi } : {}),
    ...(typeof row.pmid === 'string' ? { pmid: row.pmid } : {}),
    ...(typeof row.arxivId === 'string' ? { arxivId: row.arxivId } : {}),
    ...(typeof row.abstract === 'string' ? { abstract: row.abstract } : {}),
    ...(typeof row.bodyBase64 === 'string' ? { bodyBase64: row.bodyBase64 } : {}),
  };
}
