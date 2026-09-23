import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueJob, type QueueService } from '../l0/ports';
import { DlqService } from '../platform/queues/dlq.service';
import { assertValidQueuePayload } from '../platform/queues/queue-payload.validators';
import type { QueueName } from '../platform/queues/queue-names';
import { runWithCorrelationIdAsync } from '../platform/logging/correlation-context';
import { JobHeartbeatService } from '../platform/reliability/job-heartbeat.service';
import { getQueueLivenessPolicy } from '../platform/reliability/queue-liveness.config';
import { BillingSyncService } from './billing-sync.service';
import { UsageRollupService } from './usage-rollup.service';

@Injectable()
export class BillingQueueConsumer {
  private started = false;

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly sync: BillingSyncService,
    private readonly rollup: UsageRollupService,
    private readonly heartbeat: JobHeartbeatService,
    private readonly dlq: DlqService,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await this.queue.consume('billing-sync', (job) =>
      this.run('billing-sync', job, () => this.sync.handle(String(job.data.stripeEventId))),
    );
    await this.queue.consume('usage-rollup', (job) =>
      this.run('usage-rollup', job, () => this.rollup.handle(job.data)),
    );
  }

  private async run(
    queue: QueueName,
    job: QueueJob,
    work: () => Promise<void>,
  ): Promise<void> {
    assertValidQueuePayload(queue, job.data);
    const orgId = String(job.data.orgId);
    const correlationId = String(job.data.correlationId);
    await runWithCorrelationIdAsync(correlationId, async () => {
      await this.heartbeat.startJob({
        queue,
        jobId: job.id,
        orgId,
        correlationId,
        payload: job.data,
      });
      const timer = setInterval(() => {
        void this.heartbeat.renew({ queue, jobId: job.id });
      }, getQueueLivenessPolicy(queue).heartbeatIntervalMs);
      timer.unref();
      try {
        await work();
        await this.heartbeat.complete({ queue, jobId: job.id });
      } catch (error) {
        const exhausted = job.attemptsMade + 1 >= job.attempts;
        await this.heartbeat.complete({ queue, jobId: job.id });
        if (exhausted) {
          await this.dlq.routeExhaustedJob({
            queueName: queue,
            jobId: job.id,
            payload: job.data,
            errorMessage: error instanceof Error ? error.message : String(error),
            attemptCount: job.attemptsMade + 1,
          });
          return;
        }
        throw error;
      } finally {
        clearInterval(timer);
      }
    });
  }
}
