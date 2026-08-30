import { Inject, Injectable } from '@nestjs/common';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { EnqueueAdmissionService } from '../concurrency/enqueue-admission.service';
import { GateSlotRegistry } from '../concurrency/gate-slot.registry';
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
    private readonly admission: EnqueueAdmissionService,
    private readonly gateSlots: GateSlotRegistry,
  ) {}

  async enqueue<T extends JobEnqueueInput>(
    queueName: QueueName,
    payload: T,
    options?: { stepType?: string; orgBatchLimit?: number },
  ): Promise<string> {
    const correlationId = requireCorrelationId();
    const jobPayload = {
      ...payload,
      correlationId,
    };

    assertValidJobPayload(jobPayload);
    assertValidQueuePayload(queueName, jobPayload);

    const orgId = String(jobPayload.orgId);
    const admission = await this.admission.admitBeforeEnqueue({
      orgId,
      queueName,
      ...(options?.orgBatchLimit !== undefined ? { orgLimit: options.orgBatchLimit } : {}),
    });

    const policy = getQueuePolicy(queueName);
    const jobId = deriveJobId(queueName, jobPayload);
    const attempts = resolveAttempts(policy, options?.stepType);
    const delayMs = admission.kind === 'demoted' ? admission.delayMs : undefined;

    if (admission.kind === 'admitted') {
      await this.gateSlots.register(jobId, admission.slot);
    }

    return this.queueService.addJob(queueName, jobPayload, {
      jobId,
      ...(attempts !== undefined ? { attempts } : {}),
      ...(policy.backoff !== null ? { backoff: policy.backoff } : {}),
      ...(delayMs !== undefined ? { delayMs } : {}),
    });
  }
}
