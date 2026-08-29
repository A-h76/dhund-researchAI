import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { logAdapterLifecycle } from '../adapter-logger';
import { buildNamespacedCacheKey } from './cache-key.util';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type { CacheService } from '../../ports/cache.port';

@Injectable()
export class RedisCacheAdapter implements CacheService, OnModuleDestroy {
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
        connectTimeout: 2_000,
        commandTimeout: 2_000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      await this.client.ping();
      logAdapterLifecycle('cache', 'connect', correlationId);
    } catch (error) {
      this.client = null;
      throw new L0ConnectionError('Cache connection failed', error);
    }
  }

  async disconnect(correlationId?: string): Promise<void> {
    if (this.client === null) {
      return;
    }

    try {
      await this.client.quit();
      this.client = null;
      logAdapterLifecycle('cache', 'disconnect', correlationId);
    } catch (error) {
      throw new L0ConnectionError('Cache disconnect failed', error);
    }
  }

  async ping(): Promise<boolean> {
    const client = await this.requireClient();

    try {
      const response = await client.ping();
      return response === 'PONG';
    } catch (error) {
      throw new L0OperationError('Cache ping failed', error);
    }
  }

  async get(orgId: string, key: string): Promise<string | null> {
    const client = await this.requireClient();
    const namespacedKey = buildNamespacedCacheKey(orgId, key);

    try {
      return await client.get(namespacedKey);
    } catch (error) {
      throw new L0OperationError('Cache get failed', error);
    }
  }

  async set(orgId: string, key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = await this.requireClient();
    const namespacedKey = buildNamespacedCacheKey(orgId, key);

    try {
      if (ttlSeconds !== undefined) {
        await client.set(namespacedKey, value, 'EX', ttlSeconds);
        return;
      }

      await client.set(namespacedKey, value);
    } catch (error) {
      throw new L0OperationError('Cache set failed', error);
    }
  }

  async del(orgId: string, key: string): Promise<void> {
    const client = await this.requireClient();
    const namespacedKey = buildNamespacedCacheKey(orgId, key);

    try {
      await client.del(namespacedKey);
    } catch (error) {
      throw new L0OperationError('Cache delete failed', error);
    }
  }

  private async requireClient(): Promise<Redis> {
    if (this.client === null) {
      await this.connect();
    }

    if (this.client === null) {
      throw new L0ConnectionError('Cache is not connected');
    }

    return this.client;
  }
}
