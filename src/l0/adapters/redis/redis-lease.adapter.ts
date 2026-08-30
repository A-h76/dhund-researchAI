import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { logAdapterLifecycle } from '../adapter-logger';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type { LeaseAcquireResult, LeaseService } from '../../ports/lease.port';
import { buildLeaseKey } from './lease-key.util';

@Injectable()
export class RedisLeaseAdapter implements LeaseService, OnModuleDestroy {
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
      logAdapterLifecycle('lease', 'connect', correlationId);
    } catch (error) {
      this.client = null;
      throw new L0ConnectionError('Lease connection failed', error);
    }
  }

  async disconnect(correlationId?: string): Promise<void> {
    if (this.client === null) {
      return;
    }

    try {
      await this.client.quit();
      this.client = null;
      logAdapterLifecycle('lease', 'disconnect', correlationId);
    } catch (error) {
      throw new L0ConnectionError('Lease disconnect failed', error);
    }
  }

  async ping(): Promise<boolean> {
    const client = await this.requireClient();
    try {
      return (await client.ping()) === 'PONG';
    } catch (error) {
      throw new L0OperationError('Lease ping failed', error);
    }
  }

  async tryAcquire(
    scope: string,
    key: string,
    holderId: string,
    ttlSeconds: number,
  ): Promise<LeaseAcquireResult> {
    const client = await this.requireClient();
    const leaseKey = buildLeaseKey(scope, key);

    try {
      const acquired = await client.set(leaseKey, holderId, 'EX', ttlSeconds, 'NX');
      if (acquired === 'OK') {
        return 'acquired';
      }

      const currentHolder = await client.get(leaseKey);
      if (currentHolder === holderId) {
        await client.expire(leaseKey, ttlSeconds);
        return 'renewed';
      }

      return 'contended';
    } catch (error) {
      throw new L0OperationError('Lease acquire failed', error);
    }
  }

  async renew(scope: string, key: string, holderId: string, ttlSeconds: number): Promise<boolean> {
    const client = await this.requireClient();
    const leaseKey = buildLeaseKey(scope, key);

    try {
      const currentHolder = await client.get(leaseKey);
      if (currentHolder !== holderId) {
        return false;
      }

      await client.expire(leaseKey, ttlSeconds);
      return true;
    } catch (error) {
      throw new L0OperationError('Lease renew failed', error);
    }
  }

  async release(scope: string, key: string, holderId: string): Promise<boolean> {
    const client = await this.requireClient();
    const leaseKey = buildLeaseKey(scope, key);
    const releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `;

    try {
      const result = await client.eval(releaseScript, 1, leaseKey, holderId);
      return result === 1;
    } catch (error) {
      throw new L0OperationError('Lease release failed', error);
    }
  }

  async getHolder(scope: string, key: string): Promise<string | null> {
    const client = await this.requireClient();
    const leaseKey = buildLeaseKey(scope, key);

    try {
      return await client.get(leaseKey);
    } catch (error) {
      throw new L0OperationError('Lease getHolder failed', error);
    }
  }

  private async requireClient(): Promise<Redis> {
    if (this.client === null) {
      await this.connect();
    }

    if (this.client === null) {
      throw new L0ConnectionError('Lease is not connected');
    }

    return this.client;
  }
}
