import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTOR_CACHE_STORE,
  type ConnectorCacheStore,
} from '../l0/ports/connector-cache.port';
import { ConnectorMetrics } from './connector.metrics';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ConnectorCacheService {
  constructor(
    @Inject(CONNECTOR_CACHE_STORE) private readonly store: ConnectorCacheStore,
    private readonly metrics: ConnectorMetrics,
  ) {}

  async getJson<T>(provider: string, cacheKey: string): Promise<T | null> {
    const entry = await this.store.get(provider, cacheKey);
    if (entry === null) {
      this.metrics.recordCacheMiss(provider);
      return null;
    }
    this.metrics.recordCacheHit(provider);
    return entry.value as T;
  }

  async setJson(
    provider: string,
    cacheKey: string,
    value: unknown,
    ttlMs: number = DEFAULT_TTL_MS,
  ): Promise<void> {
    await this.store.set({
      provider,
      cacheKey,
      value,
      expiresAt: new Date(Date.now() + ttlMs),
    });
  }

  static keyFromParts(...parts: string[]): string {
    return createHash('sha256').update(parts.join('\u0000')).digest('hex');
  }
}
