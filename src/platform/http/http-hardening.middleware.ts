import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { COUNTER_SERVICE, type CounterService } from '../../l0/ports';
import { getAppConfig } from '../config';
import { MetricsSurface } from '../observability/metrics-surface';
import { applySecureHeaders } from './secure-headers';
import { decideCors } from './cors-policy';
import { HttpRateLimit } from './http-rate-limit';
import { rateLimitClassForPath } from './rate-limit-class';

interface HttpRequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly ip?: string;
  readonly headers: Record<string, unknown>;
  readonly socket?: { readonly remoteAddress?: string };
}

interface HttpResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): { end(): void };
}

type NextFunction = (error?: unknown) => void;

@Injectable()
export class HttpHardeningMiddleware implements NestMiddleware {
  private readonly rateLimit: HttpRateLimit;

  constructor(
    @Inject(COUNTER_SERVICE) counters: CounterService,
    private readonly metrics: MetricsSurface,
  ) {
    this.rateLimit = new HttpRateLimit(counters, {
      rateLimitHit: (rateClass) => this.metrics.recordRateLimitHit(rateClass),
      redisOutage: (rateClass) => this.metrics.recordRedisOutage(rateClass),
    });
  }

  use(req: HttpRequestLike, res: HttpResponseLike, next: NextFunction): void {
    applySecureHeaders(res);
    const origin = headerValue(req.headers.origin);
    const decision = decideCors(origin, getAppConfig().corsAllowedOrigins);
    if (decision === 'reject') {
      this.metrics.recordCorsRejection();
      res.status(403).end();
      return;
    }
    if (decision === 'allow' && origin !== undefined) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    const rateClass = rateLimitClassForPath(req.url);
    void this.rateLimit.enforce(rateClass, clientKey(req)).then(
      () => next(),
      (error: unknown) => next(error),
    );
  }
}

function clientKey(req: HttpRequestLike): string {
  const forwarded = headerValue(req.headers['x-forwarded-for']);
  const ip = forwarded?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || 'unknown';
  return ip.slice(0, 64);
}

function headerValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}
