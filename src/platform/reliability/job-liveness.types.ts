import type { QueueName } from '../queues/queue-names';

export interface JobLivenessRecord {
  readonly queue: QueueName;
  readonly jobId: string;
  readonly orgId: string;
  readonly correlationId: string;
  readonly startedAtMs: number;
  lastHeartbeatAtMs: number;
  readonly stepType?: string;
  readonly payload: Record<string, unknown>;
}

export interface JobLivenessStore {
  register(record: JobLivenessRecord): Promise<void>;
  heartbeat(queue: QueueName, jobId: string, atMs: number): Promise<JobLivenessRecord | null>;
  get(queue: QueueName, jobId: string): Promise<JobLivenessRecord | null>;
  remove(queue: QueueName, jobId: string): Promise<void>;
  listActive(): Promise<readonly JobLivenessRecord[]>;
}

export function buildLivenessCacheKey(queue: QueueName, jobId: string): string {
  return `job-liveness:${queue}:${jobId}`;
}

export function serializeLivenessRecord(record: JobLivenessRecord): string {
  return JSON.stringify(record);
}

export function parseLivenessRecord(raw: string): JobLivenessRecord | null {
  try {
    const parsed = JSON.parse(raw) as JobLivenessRecord;
    if (
      typeof parsed.queue !== 'string' ||
      typeof parsed.jobId !== 'string' ||
      typeof parsed.orgId !== 'string' ||
      typeof parsed.startedAtMs !== 'number' ||
      typeof parsed.lastHeartbeatAtMs !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
