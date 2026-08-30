import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { logAdapterLifecycle } from '../adapter-logger';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type { CounterService } from '../../ports/counter.port';

const INCREMENT_IF_BELOW_SCRIPT = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  local max = tonumber(ARGV[1])
  if current >= max then
    return 0
  end
  local next = redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  return next
`;

@Injectable()
export class RedisCounterAdapter implements CounterService, OnModuleDestroy {
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
      logAdapterLifecycle('counter', 'connect', correlationId);
    } catch (error) {
      this.client = null;
      throw new L0ConnectionError('Counter connection failed', error);
    }
  }

  async disconnect(correlationId?: string): Promise<void> {
    if (this.client === null) {
      return;
    }

    try {
      await this.client.quit();
      this.client = null;
      logAdapterLifecycle('counter', 'disconnect', correlationId);
    } catch (error) {
      throw new L0ConnectionError('Counter disconnect failed', error);
    }
  }

  async ping(): Promise<boolean> {
    const client = await this.requireClient();
    try {
      return (await client.ping()) === 'PONG';
    } catch (error) {
      throw new L0OperationError('Counter ping failed', error);
    }
  }

  async incrementIfBelow(key: string, max: number, ttlSeconds: number): Promise<boolean> {
    const client = await this.requireClient();
    try {
      const result = await client.eval(INCREMENT_IF_BELOW_SCRIPT, 1, key, max, ttlSeconds);
      return typeof result === 'number' && result > 0;
    } catch (error) {
      throw new L0OperationError('Counter incrementIfBelow failed', error);
    }
  }

  async decrement(key: string): Promise<number> {
    const client = await this.requireClient();
    try {
      const next = await client.decr(key);
      if (next < 0) {
        await client.set(key, '0');
        return 0;
      }
      return next;
    } catch (error) {
      throw new L0OperationError('Counter decrement failed', error);
    }
  }

  async get(key: string): Promise<number> {
    const client = await this.requireClient();
    try {
      const raw = await client.get(key);
      return raw === null ? 0 : Number.parseInt(raw, 10);
    } catch (error) {
      throw new L0OperationError('Counter get failed', error);
    }
  }

  private async requireClient(): Promise<Redis> {
    if (this.client === null) {
      await this.connect();
    }

    if (this.client === null) {
      throw new L0ConnectionError('Counter is not connected');
    }

    return this.client;
  }
}
