import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { QueueService, QueueWorkerHandle } from '../../l0/ports/queue.port';
import { QUEUE_SERVICE } from '../../l0/ports/tokens';
import { isEvidenceJobError } from '../../evidence/evidence-job.errors';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidJobPayload } from '../../platform/logging/job-payload';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { StanceService, type StanceJobPayload } from './stance.service';

@Injectable()
export class StanceJobConsumer implements OnModuleDestroy {
  private handle: QueueWorkerHandle | null = null;

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    private readonly stance: StanceService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
    private readonly logger: PlatformLogger,
  ) {}

  async start(): Promise<void> {
    if (this.handle !== null) {
      return;
    }

    const policy = getQueueLivenessPolicy('stance');
    this.handle = await this.queueService.processJobs('stance', async (job) => {
      assertValidJobPayload(job.data);
      assertValidQueuePayload('stance', job.data);

      const payload = toStancePayload(job.data);
      await runWithCorrelationIdAsync(payload.correlationId, async () => {
        await this.heartbeat.startJob({
          queue: 'stance',
          jobId: job.id,
          orgId: payload.orgId,
          correlationId: payload.correlationId,
          payload: job.data,
        });

        const heartbeatTimer = setInterval(() => {
          void this.heartbeat.renew({ queue: 'stance', jobId: job.id });
        }, policy.heartbeatIntervalMs);

        try {
          await this.stance.execute(payload, {
            onHeartbeat: async () => {
              await this.heartbeat.renew({ queue: 'stance', jobId: job.id });
            },
          });
          await this.heartbeat.complete({ queue: 'stance', jobId: job.id });
        } catch (error) {
          const jobError = isEvidenceJobError(error) ? error : null;
          const recoverable = jobError?.recoverable ?? true;
          const exhausted = job.attemptsMade + 1 >= job.attempts;

          if (!recoverable || exhausted) {
            await this.dlq.routeExhaustedJob({
              queueName: 'stance',
              jobId: job.id,
              payload: job.data,
              errorMessage: error instanceof Error ? error.message : String(error),
              attemptCount: job.attemptsMade + 1,
            });
            await this.heartbeat.complete({ queue: 'stance', jobId: job.id });
            this.logger.error({
              module: 'evidence',
              message: 'stance.failed',
              jobId: job.id,
              evidenceId: payload.evidenceId,
              recoverable,
              exhausted,
              error: error instanceof Error ? error.message : String(error),
            });
            if (!recoverable) {
              return;
            }
          } else {
            await this.heartbeat.complete({ queue: 'stance', jobId: job.id });
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
}

function toStancePayload(data: Record<string, unknown>): StanceJobPayload {
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    runId: String(data.runId),
    evidenceId: String(data.evidenceId),
    ...(typeof data.claimId === 'string' && data.claimId.length > 0
      ? { claimId: data.claimId }
      : {}),
    correlationId: String(data.correlationId),
  };
}
