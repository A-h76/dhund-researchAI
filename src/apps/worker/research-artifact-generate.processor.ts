import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  QUEUE_SERVICE,
  assertResearchRunCoverageForFinalize,
  type QueueJob,
  type QueueService,
  type ResearchRunCoverage,
} from '../../l0/ports';
import {
  ResearchArtifactGenerateService,
  type ResearchArtifactGeneratePayload,
} from '../../orchestration/research-artifact-generate.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidJobPayload } from '../../platform/logging/job-payload';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { DlqService } from '../../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class ResearchArtifactGenerateProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly generator: ResearchArtifactGenerateService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
    private readonly logger: PlatformLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('research-artifact-generate');
    await this.queue.consume('research-artifact-generate', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidJobPayload(job.data);
    assertValidQueuePayload('research-artifact-generate', job.data);
    const payload = toPayload(job.data);

    await runWithCorrelationIdAsync(payload.correlationId, async () => {
      await this.heartbeat.startJob({
        queue: 'research-artifact-generate',
        jobId: job.id,
        orgId: payload.orgId,
        correlationId: payload.correlationId,
        payload: job.data,
      });

      const intervalMs = getQueueLivenessPolicy('research-artifact-generate').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'research-artifact-generate', jobId: job.id });
      }, intervalMs);
      timer.unref();

      try {
        await this.generator.execute(payload);
        await this.heartbeat.complete({
          queue: 'research-artifact-generate',
          jobId: job.id,
        });
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        if (exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: 'research-artifact-generate',
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : String(error),
            attemptCount: job.attemptsMade + 1,
          });
          await this.heartbeat.complete({
            queue: 'research-artifact-generate',
            jobId: job.id,
          });
          this.logger.error({
            module: 'orchestration',
            message: 'research-artifact-generate.failed',
            jobId: job.id,
            runId: payload.runId,
            artifactType: payload.artifactType,
            exhausted,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        await this.heartbeat.complete({
          queue: 'research-artifact-generate',
          jobId: job.id,
        });
        throw error;
      } finally {
        clearInterval(timer);
      }
    });
  }
}

function toPayload(data: Record<string, unknown>): ResearchArtifactGeneratePayload {
  const coverageSnapshot = assertResearchRunCoverageForFinalize(data.coverageSnapshot);
  return {
    orgId: String(data.orgId),
    projectId: String(data.projectId),
    runId: String(data.runId),
    artifactType: String(data.artifactType),
    coverageSnapshotHash: String(data.coverageSnapshotHash),
    coverageSnapshot: coverageSnapshot as ResearchRunCoverage,
    correlationId: String(data.correlationId),
  };
}
