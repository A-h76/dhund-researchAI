import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { logAdapterLifecycle } from '../adapter-logger';
import { buildNamespacedCacheKey } from './cache-key.util';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type { CacheService } from '../../ports/cache.port';

@Injectable()
export class RedisCacheAdapter implements CacheService, OnModuleDestroy {
  private client: Redis | null = null;

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(correlationId?: string): Promise<void> {
    if (this.client !== null) {
      return;
    }

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new L0ConnectionError('REDIS_URL is not configured');
    }

    try {
      this.client = new Redis(redisUrl, { maxRetriesPerRequest: null });
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
