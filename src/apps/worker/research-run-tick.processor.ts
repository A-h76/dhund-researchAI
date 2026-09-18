import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../../l0/ports';
import { ResearchRunCoordinatorService } from '../../orchestration/research-run-coordinator.service';
import { runWithCorrelationIdAsync } from '../../platform/logging/correlation-context';
import { assertValidQueuePayload } from '../../platform/queues/queue-payload.validators';
import { JobHeartbeatService } from '../../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../../platform/reliability/queue-liveness.config';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class ResearchRunTickProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly coordinator: ResearchRunCoordinatorService,
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.processors.register('research-run-tick');
    await this.queue.consume('research-run-tick', (job) => this.handle(job));
  }

  async handle(job: QueueJob): Promise<void> {
    assertValidQueuePayload('research-run-tick', job.data);
    const payload = job.data;
    const runId = String(payload.runId);
    const recovery = job.attemptsMade > 0;

    await runWithCorrelationIdAsync(String(payload.correlationId), async () => {
      await this.heartbeat.startJob({
        queue: 'research-run-tick',
        jobId: job.id,
        orgId: String(payload.orgId),
        correlationId: String(payload.correlationId),
        payload,
      });
      const intervalMs = getQueueLivenessPolicy('research-run-tick').heartbeatIntervalMs;
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue: 'research-run-tick', jobId: job.id });
      }, intervalMs);
      timer.unref();
      try {
        const outcome = await this.coordinator.executeTick({ runId, recovery });
        if (
          outcome.kind === 'transitioned' &&
          outcome.toState !== 'COMPLETED' &&
          outcome.toState !== 'COMPLETED_PARTIAL' &&
          outcome.toState !== 'FAILED' &&
          outcome.toState !== 'CANCELLED' &&
          outcome.toState !== 'PAUSED_BUDGET' &&
          outcome.toState !== 'PAUSED_MANUAL'
        ) {
          await this.coordinator.enqueueTick({
            orgId: String(payload.orgId),
            projectId: String(payload.projectId),
            runId,
          });
        }
      } finally {
        clearInterval(timer);
        await this.heartbeat.complete({ queue: 'research-run-tick', jobId: job.id });
      }
    });
  }
}
