import type { BaseJobPayload } from './job-payload';

export interface ExecutionRecord {
  readonly correlationId: string;
  readonly orgId: string;
  readonly projectId?: string;
}

export interface ExecutionRecordWriter {
  record(payload: ExecutionRecord): void;
}

export class InMemoryExecutionRecordWriter implements ExecutionRecordWriter {
  private readonly records: ExecutionRecord[] = [];

  record(payload: ExecutionRecord): void {
    this.records.push({
      correlationId: payload.correlationId,
      orgId: payload.orgId,
      ...(payload.projectId !== undefined ? { projectId: payload.projectId } : {}),
    });
  }

  getRecords(): readonly ExecutionRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }
}

export function toExecutionRecord(payload: BaseJobPayload): ExecutionRecord {
  return {
    correlationId: payload.correlationId,
    orgId: payload.orgId,
    ...(payload.projectId !== undefined ? { projectId: payload.projectId } : {}),
  };
}
