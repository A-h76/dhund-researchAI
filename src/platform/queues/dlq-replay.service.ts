import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { runWithCorrelationIdAsync } from '../logging/correlation-context';
import { JobEnqueueService, type JobEnqueueInput } from '../logging/job-enqueue.service';
import { PlatformLogger } from '../logging/platform-logger.service';
import { deriveJobId } from './deterministic-job-id';
import { parseDlqPayload } from './dlq.service';
import type { QueueName } from './queue-names';

@Injectable()
export class DlqReplayService {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    private readonly enqueueService: JobEnqueueService,
    private readonly logger: PlatformLogger,
  ) {}

  async replay(
    dlqPayload: unknown,
    fullPayload: Record<string, unknown>,
  ): Promise<'noop' | 'requeued'> {
    const parsed = parseDlqPayload(dlqPayload);
    const jobId = deriveJobId(parsed.queue, {
      ...fullPayload,
      correlationId: parsed.correlationId,
    });
    const state = await this.queueService.getJobState(parsed.queue, jobId);

    if (state === 'completed') {
      this.logger.info({
        module: 'queues',
        message: 'queue.dlq.replay.noop',
        queue: parsed.queue,
        jobId,
        reason: 'already_completed',
      });
      return 'noop';
    }

    const replayPayload = { ...fullPayload } as JobEnqueueInput & { correlationId?: string };
    delete replayPayload.correlationId;

    await runWithCorrelationIdAsync(parsed.correlationId, async () => {
      await this.enqueueService.enqueue(parsed.queue as QueueName, replayPayload);
    });

    this.logger.info({
      module: 'queues',
      message: 'queue.dlq.replay.requeued',
      queue: parsed.queue,
      jobId,
    });
    return 'requeued';
  }
}
