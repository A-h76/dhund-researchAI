import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { logAdapterLifecycle } from '../adapter-logger';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type {
  QueueBackoffPolicy,
  QueueDepthSnapshot,
  QueueJobOptions,
  QueueJobProcessor,
  QueueService,
  QueueWorkerHandle,
} from '../../ports/queue.port';

@Injectable()
export class BullmqQueueAdapter implements QueueService, OnModuleDestroy {
  private connection: Redis | null = null;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();

  constructor(
    @Inject(L0_CONNECTION_CONFIG) private readonly connectionConfig: L0ConnectionConfig,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(correlationId?: string): Promise<void> {
    if (this.connection !== null) {
      return;
    }

    try {
      this.connection = new Redis(this.connectionConfig.redisUrl, {
        maxRetriesPerRequest: null,
      });
      await this.connection.ping();
      logAdapterLifecycle('queue', 'connect', correlationId);
    } catch (error) {
      this.connection = null;
      throw new L0ConnectionError('Queue connection failed', error);
    }
  }

  async disconnect(correlationId?: string): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    this.workers.clear();

    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();

    if (this.connection === null) {
      return;
    }

    try {
      await this.connection.quit();
      this.connection = null;
      logAdapterLifecycle('queue', 'disconnect', correlationId);
    } catch (error) {
      throw new L0ConnectionError('Queue disconnect failed', error);
    }
  }

  async ping(): Promise<boolean> {
    const connection = await this.requireConnection();

    try {
      const response = await connection.ping();
      return response === 'PONG';
    } catch (error) {
      throw new L0OperationError('Queue ping failed', error);
    }
  }

  async addJob<T extends Record<string, unknown>>(
    queueName: string,
    data: T,
    options: QueueJobOptions,
  ): Promise<string> {
    const queue = await this.getOrCreateQueue(queueName);

    try {
      const job = await queue.add(queueName, data, {
        jobId: options.jobId,
        ...(options.attempts !== undefined ? { attempts: options.attempts } : {}),
        ...(options.backoff !== undefined
          ? { backoff: toBullmqBackoff(options.backoff) }
          : {}),
        ...(options.delayMs !== undefined ? { delay: options.delayMs } : {}),
        // Retain recent completions so DLQ replay can detect already-completed jobs.
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      });

      if (job.id === undefined) {
        throw new L0OperationError('Queue job id missing after enqueue');
      }

      return job.id;
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Job with id') && message.includes('already exists')) {
        return options.jobId;
      }

      throw new L0OperationError('Queue enqueue failed', error);
    }
  }

  async addDlqJob<T extends Record<string, unknown>>(
    dlqName: string,
    data: T,
    jobId: string,
  ): Promise<string> {
    const queue = await this.getOrCreateQueue(dlqName);

    try {
      const job = await queue.add(dlqName, data, {
        jobId,
        removeOnComplete: false,
        removeOnFail: false,
      });

      if (job.id === undefined) {
        throw new L0OperationError('DLQ job id missing after enqueue');
      }

      return job.id;
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Job with id') && message.includes('already exists')) {
        return jobId;
      }

      throw new L0OperationError('DLQ enqueue failed', error);
    }
  }

  async getJobState(queueName: string, jobId: string): Promise<string | null> {
    const queue = await this.getOrCreateQueue(queueName);

    try {
      const job = await queue.getJob(jobId);
      if (job === undefined) {
        return null;
      }
      return await job.getState();
    } catch (error) {
      throw new L0OperationError('Queue getJobState failed', error);
    }
  }

  async retryFailedJob(
    queueName: string,
    jobId: string,
  ): Promise<'retried' | 'noop' | 'not_found'> {
    const queue = await this.getOrCreateQueue(queueName);

    try {
      const job = await queue.getJob(jobId);
      if (job === undefined) {
        return 'not_found';
      }

      const state = await job.getState();
      if (state === 'failed') {
        await job.retry();
        return 'retried';
      }

      return 'noop';
    } catch (error) {
      throw new L0OperationError('Queue retryFailedJob failed', error);
    }
  }

  async getQueueDepth(queueName: string): Promise<QueueDepthSnapshot> {
    const queue = await this.getOrCreateQueue(queueName);
    const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    };
  }

  async processJobs(
    queueName: string,
    processor: QueueJobProcessor,
    options?: { concurrency?: number },
  ): Promise<QueueWorkerHandle> {
    const existing = this.workers.get(queueName);
    if (existing !== undefined) {
      return {
        close: async () => {
          await existing.close();
          this.workers.delete(queueName);
        },
      };
    }

    const connection = await this.requireConnection();
    const worker = new Worker(
      queueName,
      async (job) => {
        const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
        await processor({
          id: job.id ?? `${queueName}-unknown`,
          data: (job.data ?? {}) as Record<string, unknown>,
          attemptsMade: job.attemptsMade,
          attempts,
        });
      },
      {
        connection,
        concurrency: options?.concurrency ?? 1,
      },
    );

    this.workers.set(queueName, worker);
    await worker.waitUntilReady();

    return {
      close: async () => {
        await worker.close();
        this.workers.delete(queueName);
      },
    };
  }

  private async getOrCreateQueue(queueName: string): Promise<Queue> {
    const existing = this.queues.get(queueName);
    if (existing) {
      return existing;
    }

    const connection = await this.requireConnection();
    const queue = new Queue(queueName, { connection });
    this.queues.set(queueName, queue);
    return queue;
  }

  private async requireConnection(): Promise<Redis> {
    if (this.connection === null) {
      await this.connect();
    }

    if (this.connection === null) {
      throw new L0ConnectionError('Queue is not connected');
    }

    return this.connection;
  }
}

function toBullmqBackoff(backoff: QueueBackoffPolicy): { type: 'exponential'; delay: number } {
  return { type: 'exponential', delay: backoff.delayMs };
}
