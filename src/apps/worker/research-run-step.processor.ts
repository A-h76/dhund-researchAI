import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import { ResearchRunCoordinatorService } from '../../orchestration/research-run-coordinator.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidJobPayload } from '../../platform/logging/job-payload';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';
import {
  ResearchRunStepExecutor,
  type ResearchRunStepJobPayload,
} from './research-run-step.executor';

@Injectable()
export class ResearchRunStepProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly executor: ResearchRunStepExecutor,
    private readonly coordinator: ResearchRunCoordinatorService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
    private readonly logger: PlatformLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('research-run-step');
    await this.queue.consume('research-run-step', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidJobPayload(job.data);
    assertValidQueuePayload('research-run-step', job.data);
    const payload = toStepPayload(job.data);

    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'research-run-step',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
        stepType: payload.stepType,
      });

      const intervalMs = getQueueLivenessPolicy('research-run-step').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'research-run-step', jobId: job.id });
      }, intervalMs);
      timer.unref();

      try {
        await this.executor.execute(payload, {
          onHeartbeat: async () => {
            await this.heartbeat.renew({ queue: 'research-run-step', jobId: job.id });
          },
        });
        await this.heartbeat.complete({ queue: 'research-run-step', jobId: job.id });
        await this.coordinator.enqueueTick({
          orgId: payload.orgId,
          projectId: payload.projectId,
          runId: payload.runId,
        });
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (exhausted) {
          await this.executor.fail(payload);
          await this.dlq.routeExhaustedJob({
            queueName: 'research-run-step',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : String(error),
            attemptCount: job.attemptsMade + 1,
          });
          await this.heartbeat.complete({ queue: 'research-run-step', jobId: job.id });
          this.logger.error({
            module: 'orchestration',
            message: 'research-run-step.failed',
            jobId: job.id,
            stepId: payload.stepId,
            stepType: payload.stepType,
            exhausted,
            error: error instanceof Error ? error.message : String(error),
          });
          await this.coordinator.enqueueTick({
            orgId: payload.orgId,
            projectId: payload.projectId,
            runId: payload.runId,
          });
          return;
        }
        await this.heartbeat.complete({ queue: 'research-run-step', jobId: job.id });
        throw error;
      } finally {
        clearInterval(timer);
      }
    });
  }
}

function toStepPayload(data: Record<string, unknown>): ResearchRunStepJobPayload {
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    runId: String(data.runId),
    stepId: String(data.stepId),
    stepType: String(data.stepType),
    inputFingerprint: String(data.inputFingerprint),
    stepVersion: String(data.stepVersion),
    correlationId: String(data.correlationId),
    ...(typeof data.query === 'string' ? { query: data.query } : {}),
    ...(typeof data.documentVersionId === 'string'
      ? { documentVersionId: data.documentVersionId }
      : {}),
    ...(typeof data.contentHash === 'string' ? { contentHash: data.contentHash } : {}),
    ...(typeof data.sourceId === 'string' ? { sourceId: data.sourceId } : {}),
  };
}
