import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { logAdapterLifecycle } from '../adapter-logger';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type { PubSubService } from '../../ports/pubsub.port';

@Injectable()
export class RedisPubSubAdapter implements PubSubService, OnModuleDestroy {
  private client: Redis | null = null;

  constructor(
    @Inject(L0_CONNECTION_CONFIG) private readonly connectionConfig: L0ConnectionConfig,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(correlationId?: string): Promise<void> {
    if (this.client !== null) {
      return;
    }

    try {
      this.client = new Redis(this.connectionConfig.redisUrl, {
        maxRetriesPerRequest: 1,
      });
      await this.client.ping();
      logAdapterLifecycle('pubsub', 'connect', correlationId);
    } catch (error) {
      this.client = null;
      throw new L0ConnectionError('PubSub connection failed', error);
    }
  }

  async disconnect(correlationId?: string): Promise<void> {
    if (this.client === null) {
      return;
    }

    try {
      await this.client.quit();
      this.client = null;
      logAdapterLifecycle('pubsub', 'disconnect', correlationId);
    } catch (error) {
      throw new L0ConnectionError('PubSub disconnect failed', error);
    }
  }

  async ping(): Promise<boolean> {
    const client = await this.requireClient();
    try {
      return (await client.ping()) === 'PONG';
    } catch (error) {
      throw new L0OperationError('PubSub ping failed', error);
    }
  }

  async publish(channel: string, message: string): Promise<void> {
    const client = await this.requireClient();
    try {
      await client.publish(channel, message);
    } catch (error) {
      throw new L0OperationError('PubSub publish failed', error);
    }
  }

  private async requireClient(): Promise<Redis> {
    if (this.client === null) {
      await this.connect();
    }
    if (this.client === null) {
      throw new L0ConnectionError('PubSub is not connected');
    }
    return this.client;
  }
}
