import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import {
  ConnectorFetchService,
  type ConnectorFetchJobPayload,
} from '../../connectors/connector-fetch.service';
import { isConnectorJobError } from '../../connectors/connector-job.errors';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class ConnectorFetchProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly fetch: ConnectorFetchService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('connector-fetch');
    await this.queue.consume('connector-fetch', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('connector-fetch', job.data);
    const payload = toPayload(job.data);
    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'connector-fetch',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });
      const intervalMs = getQueueLivenessPolicy('connector-fetch').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'connector-fetch', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.fetch.execute(payload);
      } catch (error) {
        const jobError = isConnectorJobError(error) ? error : null;
        const recoverable = jobError?.recoverable ?? true;
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (!recoverable || exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'connector-fetch',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : 'connector-fetch failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        if (!recoverable) {
          return;
        }
        throw error;
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'connector-fetch', jobId: job.id });
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): ConnectorFetchJobPayload {
  return {
    orgId: String(data.orgId),
    connectorId: String(data.connectorId),
    externalId: String(data.externalId),
    purpose: String(data.purpose),
    freshnessTtl: Number(data.freshnessTtl),
    correlationId: String(data.correlationId),
    ...(data.includeBody === true ? { includeBody: true } : {}),
  };
}
