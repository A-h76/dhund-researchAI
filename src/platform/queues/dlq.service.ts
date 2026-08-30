import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { QUEUE_SERVICE, type QueueService } from '../../l0/ports';
import { PlatformLogger } from '../logging/platform-logger.service';
import { buildDlqEntry } from './dlq-sanitize';
import { extractNaturalKey } from './natural-key';
import { canonicalJson } from './canonical-json';
import { dlqNameFor, isQueueName, type QueueName } from './queue-names';
import { getQueuePolicy } from './queue-registry';

@Injectable()
export class DlqService {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: QueueService,
    private readonly logger: PlatformLogger,
  ) {}

  async routeExhaustedJob(input: {
    queueName: QueueName;
    jobId: string;
    payload: Record<string, unknown>;
    errorMessage: string;
    attemptCount: number;
  }): Promise<string> {
    const policy = getQueuePolicy(input.queueName);
    const orgId = String(input.payload.orgId);
    const correlationId = String(input.payload.correlationId);
    const projectId =
      input.payload.projectId !== undefined ? String(input.payload.projectId) : undefined;

    const dlqPayload = buildDlqEntry({
      originalJobId: input.jobId,
      queue: input.queueName,
      orgId,
      ...(projectId !== undefined ? { projectId } : {}),
      correlationId,
      naturalKey: extractNaturalKey(input.queueName, input.payload),
      errorMessage: input.errorMessage,
      failedAt: new Date().toISOString(),
      attemptCount: input.attemptCount,
    });

    const dlqJobId = deriveDlqJobId(input.queueName, input.jobId);
    const dlqJobIdResult = await this.queueService.addDlqJob(
      policy.dlqName,
      dlqPayload,
      dlqJobId,
    );

    this.logger.warn({
      module: 'queues',
      message: 'queue.dlq.entry',
      queue: input.queueName,
      dlq: policy.dlqName,
      jobId: input.jobId,
      dlqJobId: dlqJobIdResult,
      attemptCount: input.attemptCount,
      orgId,
      ...(projectId !== undefined ? { projectId } : {}),
    });

    return dlqJobIdResult;
  }
}

export function deriveDlqJobId(queueName: QueueName, originalJobId: string): string {
  // BullMQ custom job IDs must not contain ':' — dlq queue name is separate from jobId.
  return createHash('sha256')
    .update(canonicalJson({ dlq: dlqNameFor(queueName), originalJobId }))
    .digest('hex');
}

export function parseDlqPayload(payload: unknown): {
  queue: QueueName;
  originalJobId: string;
  naturalKey: Record<string, unknown>;
  orgId: string;
  correlationId: string;
  projectId?: string;
} {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('DLQ payload must be an object');
  }

  const record = payload as Record<string, unknown>;
  const queue = record.queue;
  if (typeof queue !== 'string' || !isQueueName(queue)) {
    throw new Error('DLQ payload queue is invalid');
  }

  if (typeof record.originalJobId !== 'string' || record.originalJobId.length === 0) {
    throw new Error('DLQ payload originalJobId is invalid');
  }

  if (typeof record.naturalKey !== 'object' || record.naturalKey === null) {
    throw new Error('DLQ payload naturalKey is invalid');
  }

  return {
    queue,
    originalJobId: record.originalJobId,
    naturalKey: record.naturalKey as Record<string, unknown>,
    orgId: String(record.orgId),
    correlationId: String(record.correlationId),
    ...(record.projectId !== undefined ? { projectId: String(record.projectId) } : {}),
  };
}
