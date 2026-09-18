import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
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
export class StanceJobConsumer {
  private started = false;

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    private readonly stance: StanceService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
    private readonly logger: PlatformLogger,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const policy = getQueueLivenessPolicy('stance');
    await this.queueService.consume('stance', async (job) => {
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
        heartbeatTimer.unref();

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
