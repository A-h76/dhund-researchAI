import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { EVIDENCE_EXTRACT_STEP_TYPE } from '../../evidence/extract.constants';
import { isEvidenceJobError } from '../../evidence/evidence-job.errors';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidJobPayload } from '../../platform/logging/job-payload';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import {
  EvidenceExtractService,
  type EvidenceExtractJobPayload,
} from './evidence-extract.service';

@Injectable()
export class EvidenceExtractJobConsumer {
  private started = false;

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    private readonly extract: EvidenceExtractService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
    private readonly logger: PlatformLogger,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const policy = getQueueLivenessPolicy('research-run-step');
    await this.queueService.consume('research-run-step', async (job) => {
      assertValidJobPayload(job.data);
      assertValidQueuePayload('research-run-step', job.data);

      const payload = toExtractPayload(job.data);
      await runWithCorrelationIdAsync(payload.correlationId, async () => {
        await this.heartbeat.startJob({
          queue: 'research-run-step',
          jobId: job.id,
          orgId: payload.orgId,
          correlationId: payload.correlationId,
          payload: job.data,
          stepType: payload.stepType,
        });

        const heartbeatTimer = setInterval(() => {
          void this.heartbeat.renew({ queue: 'research-run-step', jobId: job.id });
        }, policy.heartbeatIntervalMs);
        heartbeatTimer.unref();

        try {
          await this.extract.execute(payload, {
            onHeartbeat: async () => {
              await this.heartbeat.renew({ queue: 'research-run-step', jobId: job.id });
            },
          });
          await this.heartbeat.complete({ queue: 'research-run-step', jobId: job.id });
        } catch (error) {
          const jobError = isEvidenceJobError(error) ? error : null;
          const recoverable = jobError?.recoverable ?? true;
          const exhausted = job.attemptsMade + 1 >= job.attempts;

          if (!recoverable || exhausted) {
            await this.dlq.routeExhaustedJob({
              queueName: 'research-run-step',
              jobId: job.id,
              payload: job.data,
              errorMessage: error instanceof Error ? error.message : String(error),
              attemptCount: job.attemptsMade + 1,
            });
            await this.heartbeat.complete({ queue: 'research-run-step', jobId: job.id });
            this.logger.error({
              module: 'evidence',
              message: 'evidence-extract.failed',
              jobId: job.id,
              stepId: payload.stepId,
              recoverable,
              exhausted,
              error: error instanceof Error ? error.message : String(error),
            });
            if (!recoverable) {
              return;
            }
          } else {
            await this.heartbeat.complete({ queue: 'research-run-step', jobId: job.id });
          }

          throw error;
        } finally {
          clearInterval(heartbeatTimer);
        }
      });
    });
  }
}

function toExtractPayload(data: Record<string, unknown>): EvidenceExtractJobPayload {
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    runId: String(data.runId),
    stepId: String(data.stepId),
    stepType: String(data.stepType ?? EVIDENCE_EXTRACT_STEP_TYPE),
    inputFingerprint: String(data.inputFingerprint),
    stepVersion: String(data.stepVersion),
    sourceId: String(data.sourceId ?? ''),
    documentVersionId: String(data.documentVersionId ?? ''),
    correlationId: String(data.correlationId),
  };
}
