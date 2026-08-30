import type { QueueName } from '../queues/queue-names';
import type { JobLivenessRecord, JobLivenessStore } from './job-liveness.types';

export class InMemoryJobLivenessStore implements JobLivenessStore {
  private readonly records = new Map<string, JobLivenessRecord>();

  async register(record: JobLivenessRecord): Promise<void> {
    this.records.set(this.key(record.queue, record.jobId), { ...record });
  }

  async heartbeat(queue: QueueName, jobId: string, atMs: number): Promise<JobLivenessRecord | null> {
    const existing = this.records.get(this.key(queue, jobId));
    if (existing === undefined) {
      return null;
    }

    existing.lastHeartbeatAtMs = atMs;
    return { ...existing };
  }

  async get(queue: QueueName, jobId: string): Promise<JobLivenessRecord | null> {
    const existing = this.records.get(this.key(queue, jobId));
    return existing === undefined ? null : { ...existing };
  }

  async remove(queue: QueueName, jobId: string): Promise<void> {
    this.records.delete(this.key(queue, jobId));
  }

  async listActive(): Promise<readonly JobLivenessRecord[]> {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  private key(queue: QueueName, jobId: string): string {
    return `${queue}:${jobId}`;
  }
}
