import { Inject, Injectable } from '@nestjs/common';
import { CACHE_SERVICE, type CacheService } from '../../l0/ports';
import type { QueueName } from '../queues/queue-names';
import {
  buildLivenessCacheKey,
  parseLivenessRecord,
  serializeLivenessRecord,
  type JobLivenessRecord,
  type JobLivenessStore,
} from './job-liveness.types';

@Injectable()
export class RedisJobLivenessStore implements JobLivenessStore {
  private readonly activeIndexKey = 'job-liveness:active-index';

  constructor(@Inject(CACHE_SERVICE) private readonly cache: CacheService) {}

  async register(record: JobLivenessRecord): Promise<void> {
    const key = buildLivenessCacheKey(record.queue, record.jobId);
    await this.cache.set(record.orgId, key, serializeLivenessRecord(record));
    await this.addToIndex(record.orgId, key);
  }

  async heartbeat(queue: QueueName, jobId: string, atMs: number): Promise<JobLivenessRecord | null> {
    const existing = await this.findByQueueJob(queue, jobId);
    if (existing === null) {
      return null;
    }

    existing.lastHeartbeatAtMs = atMs;
    const key = buildLivenessCacheKey(queue, jobId);
    await this.cache.set(existing.orgId, key, serializeLivenessRecord(existing));
    return existing;
  }

  async get(queue: QueueName, jobId: string): Promise<JobLivenessRecord | null> {
    return this.findByQueueJob(queue, jobId);
  }

  async remove(queue: QueueName, jobId: string): Promise<void> {
    const existing = await this.findByQueueJob(queue, jobId);
    if (existing === null) {
      return;
    }

    const key = buildLivenessCacheKey(queue, jobId);
    await this.cache.del(existing.orgId, key);
    await this.removeFromIndex(existing.orgId, key);
  }

  async listActive(): Promise<readonly JobLivenessRecord[]> {
    const index = await this.readIndex();
    const records: JobLivenessRecord[] = [];

    for (const entry of index) {
      const raw = await this.cache.get(entry.orgId, entry.key);
      if (raw === null) {
        continue;
      }
      const parsed = parseLivenessRecord(raw);
      if (parsed !== null) {
        records.push(parsed);
      }
    }

    return records;
  }

  private async findByQueueJob(queue: QueueName, jobId: string): Promise<JobLivenessRecord | null> {
    const index = await this.readIndex();
    const key = buildLivenessCacheKey(queue, jobId);
    const entry = index.find((candidate) => candidate.key === key);
    if (entry === undefined) {
      return null;
    }

    const raw = await this.cache.get(entry.orgId, key);
    if (raw === null) {
      return null;
    }

    return parseLivenessRecord(raw);
  }

  private async readIndex(): Promise<Array<{ orgId: string; key: string }>> {
    const raw = await this.cache.get('__platform__', this.activeIndexKey);
    if (raw === null) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as Array<{ orgId: string; key: string }>;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeIndex(entries: Array<{ orgId: string; key: string }>): Promise<void> {
    await this.cache.set('__platform__', this.activeIndexKey, JSON.stringify(entries));
  }

  private async addToIndex(orgId: string, key: string): Promise<void> {
    const index = await this.readIndex();
    if (index.some((entry) => entry.orgId === orgId && entry.key === key)) {
      return;
    }
    index.push({ orgId, key });
    await this.writeIndex(index);
  }

  private async removeFromIndex(orgId: string, key: string): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex(index.filter((entry) => !(entry.orgId === orgId && entry.key === key)));
  }
}
