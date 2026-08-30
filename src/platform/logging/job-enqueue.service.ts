import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { requireCorrelationId } from './correlation-context';
import { assertValidJobPayload, type BaseJobPayload } from './job-payload';
import { deriveJobId } from '../queues/deterministic-job-id';
import { assertValidQueuePayload } from '../queues/queue-payload.validators';
import { getQueuePolicy, resolveAttempts } from '../queues/queue-registry';
import type { QueueName } from '../queues/queue-names';

export type JobEnqueueInput = Omit<BaseJobPayload, 'correlationId'> &
  Record<string, unknown>;

@Injectable()
export class JobEnqueueService {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
  ) {}

  async enqueue<T extends JobEnqueueInput>(
    queueName: QueueName,
    payload: T,
    options?: { stepType?: string },
  ): Promise<string> {
    const correlationId = requireCorrelationId();
    const jobPayload = {
      ...payload,
      correlationId,
    };

    assertValidJobPayload(jobPayload);
    assertValidQueuePayload(queueName, jobPayload);

    const policy = getQueuePolicy(queueName);
    const jobId = deriveJobId(queueName, jobPayload);
    const attempts = resolveAttempts(policy, options?.stepType);

    return this.queueService.addJob(queueName, jobPayload, {
      jobId,
      ...(attempts !== undefined ? { attempts } : {}),
      ...(policy.backoff !== null ? { backoff: policy.backoff } : {}),
    });
  }
}
