import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { logAdapterLifecycle } from '../adapter-logger';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type { QueueService } from '../../ports/queue.port';

@Injectable()
export class BullmqQueueAdapter implements QueueService, OnModuleDestroy {
  private connection: Redis | null = null;
  private readonly queues = new Map<string, Queue>();

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

  async addJob<T extends Record<string, unknown>>(queueName: string, data: T): Promise<string> {
    const queue = await this.getOrCreateQueue(queueName);

    try {
      const job = await queue.add(queueName, data);
      if (job.id === undefined) {
        throw new L0OperationError('Queue job id missing after enqueue');
      }

      return job.id;
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }

      throw new L0OperationError('Queue enqueue failed', error);
    }
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
