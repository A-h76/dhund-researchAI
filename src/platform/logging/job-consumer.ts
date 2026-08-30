import { runWithCorrelationId } from './correlation-context';
import {
  type ExecutionRecordWriter,
  toExecutionRecord,
} from './execution-record';
import { assertValidJobPayload, type BaseJobPayload } from './job-payload';
import type { PlatformLogger } from './platform-logger.service';
import { isQueueName } from '../queues/queue-names';
import { assertValidQueuePayload } from '../queues/queue-payload.validators';

export function processValidatedJobPayload(
  queueName: string,
  payload: BaseJobPayload,
  writer: ExecutionRecordWriter,
  logger: PlatformLogger,
): void {
  runWithCorrelationId(payload.correlationId, () => {
    logger.info({
      module: 'worker',
      message: 'job.received',
      queue: queueName,
      orgId: payload.orgId,
      ...(payload.projectId !== undefined ? { projectId: payload.projectId } : {}),
    });
    writer.record(toExecutionRecord(payload));
  });
}

export function consumeJobPayload(
  queueName: string,
  payload: unknown,
  writer: ExecutionRecordWriter,
  logger: PlatformLogger,
): void {
  assertValidJobPayload(payload);
  if (isQueueName(queueName)) {
    assertValidQueuePayload(queueName, payload);
  }
  processValidatedJobPayload(queueName, payload, writer, logger);
}
