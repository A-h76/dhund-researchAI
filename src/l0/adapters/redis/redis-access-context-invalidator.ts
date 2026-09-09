import { Inject, Injectable } from '@nestjs/common';
import type { AccessContextInvalidator } from '../../ports/access-context-invalidator.port';
import {
  ACCESS_CONTEXT_CACHE_ORG_ID,
  accessContextCacheKey,
} from '../../ports/access-context-cache';
import type { CacheService } from '../../ports/cache.port';
import { CACHE_SERVICE } from '../../ports/tokens';

@Injectable()
export class RedisAccessContextInvalidator implements AccessContextInvalidator {
  constructor(
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
  ) {}

  async invalidateAccessContext(userId: string): Promise<void> {
    try {
      await this.cache.del(
        ACCESS_CONTEXT_CACHE_ORG_ID,
        accessContextCacheKey(userId),
      );
    } catch {
      console.warn(
        JSON.stringify({ msg: 'l0.access_context.invalidate_failed' }),
      );
    }
  }
}
