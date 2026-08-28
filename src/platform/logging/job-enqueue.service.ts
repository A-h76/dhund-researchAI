import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { requireCorrelationId } from './correlation-context';
import { assertValidJobPayload, type BaseJobPayload } from './job-payload';

export type JobEnqueueInput = Omit<BaseJobPayload, 'correlationId'> &
  Record<string, unknown>;

@Injectable()
export class JobEnqueueService {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
  ) {}

  async enqueue<T extends JobEnqueueInput>(
    queueName: string,
    payload: T,
  ): Promise<string> {
    const correlationId = requireCorrelationId();
    const jobPayload = {
      ...payload,
      correlationId,
    };

    assertValidJobPayload(jobPayload);
    return this.queueService.addJob(queueName, jobPayload);
  }
}
