import { Inject, Injectable } from '@nestjs/common';
import { CACHE_SERVICE, type CacheService } from '../../l0/ports';
import { OutboxMetrics } from './outbox-metrics';

const PROCESSED_KEY_PREFIX = 'events:processed:';
const PROCESSED_TTL_SECONDS = 60 * 60 * 24 * 7;

export type IdempotentConsumeResult = 'applied' | 'duplicate';

/**
 * Consumer idempotency by eventId — re-delivery performs no second side effect.
 */
@Injectable()
export class ConsumerIdempotencyService {
  constructor(
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    private readonly metrics: OutboxMetrics,
  ) {}

  async runOnce(
    eventId: string,
    sideEffect: () => Promise<void> | void,
  ): Promise<IdempotentConsumeResult> {
    const key = `${PROCESSED_KEY_PREFIX}${eventId}`;
    const existing = await this.cache.get('__platform__', key);
    if (existing !== null) {
      this.metrics.recordDuplicateDelivery();
      return 'duplicate';
    }

    await sideEffect();
    await this.cache.set('__platform__', key, '1', PROCESSED_TTL_SECONDS);
    return 'applied';
  }

  async hasProcessed(eventId: string): Promise<boolean> {
    const key = `${PROCESSED_KEY_PREFIX}${eventId}`;
    return (await this.cache.get('__platform__', key)) !== null;
  }
}
