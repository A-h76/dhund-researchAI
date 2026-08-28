import { runWithCorrelationId } from './correlation-context';
import {
  type ExecutionRecordWriter,
  toExecutionRecord,
} from './execution-record';
import { assertValidJobPayload, type BaseJobPayload } from './job-payload';
import type { PlatformLogger } from './platform-logger.service';

export function processValidatedJobPayload(
  payload: BaseJobPayload,
  writer: ExecutionRecordWriter,
  logger: PlatformLogger,
): void {
  runWithCorrelationId(payload.correlationId, () => {
    logger.info({
      module: 'worker',
      message: 'job.received',
      orgId: payload.orgId,
      ...(payload.projectId !== undefined ? { projectId: payload.projectId } : {}),
    });
    writer.record(toExecutionRecord(payload));
  });
}

export function consumeJobPayload(
  payload: unknown,
  writer: ExecutionRecordWriter,
  logger: PlatformLogger,
): void {
  assertValidJobPayload(payload);
  processValidatedJobPayload(payload, writer, logger);
}
