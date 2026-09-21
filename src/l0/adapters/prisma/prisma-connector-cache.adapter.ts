import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateId } from '../../../platform/ids';
import { L0OperationError } from '../../ports/errors';
import type {
  ConnectorCacheEntry,
  ConnectorCacheStore,
} from '../../ports/connector-cache.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

/**
 * Durable connector response cache in Postgres (GAP-CONN-CACHE-01).
 * Must survive a Redis flush — never backed by Redis.
 */
@Injectable()
export class PrismaConnectorCacheAdapter implements ConnectorCacheStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async get(provider: string, cacheKey: string): Promise<ConnectorCacheEntry | null> {
    await this.database.connect();
    try {
      const row = await this.client().connectorCache.findUnique({
        where: {
          provider_cacheKey: { provider, cacheKey },
        },
      });
      if (row === null) {
        return null;
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      return {
        provider: row.provider,
        cacheKey: row.cacheKey,
        value: row.value,
        expiresAt: row.expiresAt,
      };
    } catch (error) {
      throw new L0OperationError('connector_cache get failed', error);
    }
  }

  async set(input: {
    readonly provider: string;
    readonly cacheKey: string;
    readonly value: unknown;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.database.connect();
    try {
      await this.client().connectorCache.upsert({
        where: {
          provider_cacheKey: {
            provider: input.provider,
            cacheKey: input.cacheKey,
          },
        },
        create: {
          id: generateId(),
          provider: input.provider,
          cacheKey: input.cacheKey,
          value: input.value as Prisma.InputJsonValue,
          expiresAt: input.expiresAt,
        },
        update: {
          value: input.value as Prisma.InputJsonValue,
          expiresAt: input.expiresAt,
        },
      });
    } catch (error) {
      throw new L0OperationError('connector_cache set failed', error);
    }
  }

  async delete(provider: string, cacheKey: string): Promise<void> {
    await this.database.connect();
    try {
      await this.client().connectorCache.deleteMany({
        where: { provider, cacheKey },
      });
    } catch (error) {
      throw new L0OperationError('connector_cache delete failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}
