import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import { isConnectorJobError } from '../../connectors/connector-job.errors';
import {
  DiscoverySearchService,
  type DiscoverySearchJobPayload,
} from '../../connectors/discovery-search.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class DiscoverySearchProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly discovery: DiscoverySearchService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('discovery-search');
    await this.queue.consume('discovery-search', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('discovery-search', job.data);
    const payload = toPayload(job.data);
    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'discovery-search',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });
      const intervalMs = getQueueLivenessPolicy('discovery-search').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'discovery-search', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.discovery.execute(payload);
      } catch (error) {
        const jobError = isConnectorJobError(error) ? error : null;
        const recoverable = jobError?.recoverable ?? true;
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (!recoverable || exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'discovery-search',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : 'discovery-search failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        if (!recoverable) {
          return;
        }
        throw error;
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'discovery-search', jobId: job.id });
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): DiscoverySearchJobPayload {
  const connectorIds = Array.isArray(data.connectorIds)
    ? data.connectorIds.map((id) => String(id))
    : [];
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    connectorIds,
    query: String(data.query),
    correlationId: String(data.correlationId),
    ...(typeof data.queryId === 'string' && data.queryId.length > 0
      ? { queryId: data.queryId }
      : {}),
    ...(typeof data.limit === 'number' ? { limit: data.limit } : {}),
  };
}
