import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import { isEvidenceJobError } from '../../evidence/evidence-job.errors';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidJobPayload } from '../../platform/logging/job-payload';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';
import { SynthesisService, type SynthesisJobPayload } from './synthesis.service';

@Injectable()
export class SynthesisProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly synthesis: SynthesisService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
    private readonly logger: PlatformLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('synthesis');
    await this.queue.consume('synthesis', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidJobPayload(job.data);
    assertValidQueuePayload('synthesis', job.data);
    const payload = toPayload(job.data);

    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'synthesis',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });

      const intervalMs = getQueueLivenessPolicy('synthesis').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'synthesis', jobId: job.id });
      }, intervalMs);
      timer.unref();

      try {
        await this.synthesis.execute(payload, {
          onHeartbeat: async () => {
            await this.heartbeat.renew({ queue: 'synthesis', jobId: job.id });
          },
        });
        await this.heartbeat.complete({ queue: 'synthesis', jobId: job.id });
      } catch (error) {
        const jobError = isEvidenceJobError(error) ? error : null;
        const recoverable = jobError?.recoverable ?? true;
        const exhausted = job.attemptsMade + 1 >= job.attempts;

        if (!recoverable || exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'synthesis',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : String(error),
            attemptCount: job.attemptsMade + 1,
          });
          await this.heartbeat.complete({ queue: 'synthesis', jobId: job.id });
          this.logger.error({
            module: 'evidence',
            message: 'synthesis.failed',
            jobId: job.id,
            claimId: payload.claimId,
            runId: payload.runId,
            recoverable,
            exhausted,
            error: error instanceof Error ? error.message : String(error),
          });
          if (!recoverable) {
            return;
          }
        } else {
          await this.heartbeat.complete({ queue: 'synthesis', jobId: job.id });
        }

        throw error;
      } finally {
        clearInterval(timer);
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): SynthesisJobPayload {
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    runId: String(data.runId),
    claimId: String(data.claimId),
    promptVersion: String(data.promptVersion),
    correlationId: String(data.correlationId),
  };
}
