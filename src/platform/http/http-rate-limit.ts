import { L0Error } from '../../l0/ports/errors';
import type { CounterService } from '../../l0/ports/counter.port';
import { DomainError, ErrorCode } from '../errors';
import {
  failsClosedOnRedisOutage,
  RATE_LIMIT_BUDGETS,
  type RateLimitClass,
} from './rate-limit-class';

export interface RateLimitObserver {
  rateLimitHit(rateClass: RateLimitClass): void;
  redisOutage(rateClass: RateLimitClass): void;
}

export class HttpRateLimit {
  constructor(
    private readonly counters: Pick<CounterService, 'incrementIfBelow'>,
    private readonly observer: RateLimitObserver = {
      rateLimitHit: () => undefined,
      redisOutage: () => undefined,
    },
  ) {}

  async enforce(rateClass: RateLimitClass, clientKey: string): Promise<void> {
    const budget = RATE_LIMIT_BUDGETS[rateClass];
    try {
      const allowed = await this.counters.incrementIfBelow(
        `ratelimit:${rateClass}:${clientKey}`,
        budget.max,
        budget.ttlSeconds,
      );
      if (!allowed) {
        this.observer.rateLimitHit(rateClass);
        throw limited(rateClass, budget.ttlSeconds);
      }
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      if (!isCounterOutage(error)) {
        throw error;
      }
      this.observer.redisOutage(rateClass);
      if (failsClosedOnRedisOutage(rateClass)) {
        throw limited(rateClass, budget.ttlSeconds);
      }
    }
  }
}

function limited(rateClass: RateLimitClass, retryAfterSeconds: number): DomainError {
  return new DomainError(ErrorCode.RateLimited, {
    module: 'http',
    details: { retryAfterSeconds, rateClass },
  });
}

function isCounterOutage(error: unknown): boolean {
  return error instanceof L0Error;
}
