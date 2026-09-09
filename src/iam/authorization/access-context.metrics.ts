import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging';

export type AccessDenialReason =
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden';

export interface AccessContextMetricsSnapshot {
  readonly cacheHit: number;
  readonly cacheMiss: number;
  readonly denials: {
    readonly unauthenticated: number;
    readonly not_found: number;
    readonly forbidden: number;
  };
}

@Injectable()
export class AccessContextMetrics {
  private cacheHit = 0;
  private cacheMiss = 0;
  private unauthenticated = 0;
  private notFound = 0;
  private forbidden = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordCacheHit(): void {
    this.cacheHit += 1;
    this.logger.info({
      module: 'iam',
      message: 'access_context.cache_hit',
    });
  }

  recordCacheMiss(): void {
    this.cacheMiss += 1;
    this.logger.info({
      module: 'iam',
      message: 'access_context.cache_miss',
    });
  }

  recordDenial(reason: AccessDenialReason): void {
    if (reason === 'unauthenticated') {
      this.unauthenticated += 1;
    } else if (reason === 'not_found') {
      this.notFound += 1;
    } else {
      this.forbidden += 1;
    }
    this.logger.info({
      module: 'iam',
      message: 'authz.denied',
      reason,
    });
  }

  snapshot(): AccessContextMetricsSnapshot {
    return {
      cacheHit: this.cacheHit,
      cacheMiss: this.cacheMiss,
      denials: {
        unauthenticated: this.unauthenticated,
        not_found: this.notFound,
        forbidden: this.forbidden,
      },
    };
  }
}
