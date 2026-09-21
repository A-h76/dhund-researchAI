import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import {
  IdentityResolveService,
  type IdentityResolveJobPayload,
} from '../../identity/identity-resolve.service';
import type { IdentifierSchemeValue } from '../../l0/ports/identity-spine.port';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class IdentityResolveProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly resolve: IdentityResolveService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('identity-resolve');
    await this.queue.consume('identity-resolve', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('identity-resolve', job.data);
    const payload = toPayload(job.data);
    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'identity-resolve',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });
      const intervalMs = getQueueLivenessPolicy('identity-resolve').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'identity-resolve', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        await this.resolve.execute(payload);
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'identity-resolve',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : 'identity-resolve failed',
            attemptCount: job.attemptsMade + 1,
          });
        }
        throw error;
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'identity-resolve', jobId: job.id });
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): IdentityResolveJobPayload {
  const identifier = data.identifier as { scheme: string; value: string };
  return {
    orgId: String(data.orgId),
    correlationId: String(data.correlationId),
    identifier: {
      scheme: identifier.scheme as IdentifierSchemeValue,
      value: identifier.value,
    },
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    ...(Array.isArray(data.authors)
      ? { authors: data.authors.map((author) => String(author)) }
      : {}),
    ...(typeof data.year === 'number' ? { year: data.year } : {}),
    ...(typeof data.documentId === 'string' ? { documentId: data.documentId } : {}),
    ...(typeof data.externalRecordId === 'string'
      ? { externalRecordId: data.externalRecordId }
      : {}),
    ...(typeof data.candidateWorkId === 'string'
      ? { candidateWorkId: data.candidateWorkId }
      : {}),
  };
}
