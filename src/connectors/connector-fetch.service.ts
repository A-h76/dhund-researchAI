import { Injectable } from '@nestjs/common';
import { DomainError, ErrorCode } from '../platform/errors';
import { ConnectorCircuitBreakerRegistry } from './connector-circuit-breaker';
import { ConnectorCacheService } from './connector-cache.service';
import {
  ConnectorCircuitOpenError,
  ConnectorJobError,
  ConnectorRateLimitedJobError,
} from './connector-job.errors';
import { ConnectorMetrics } from './connector.metrics';
import { ConnectorRateLimiter } from './connector-rate-limiter';
import { SourceConnectorRegistry } from './connector.registry';
import { ArxivRateLimitedError } from './adapters/arxiv.connector';
import type { ConnectorFetchResult } from './source-connector';

export interface ConnectorFetchJobPayload {
  readonly orgId: string;
  readonly connectorId: string;
  readonly externalId: string;
  readonly purpose: string;
  readonly freshnessTtl: number;
  readonly correlationId: string;
  readonly includeBody?: boolean;
}

@Injectable()
export class ConnectorFetchService {
  constructor(
    private readonly registry: SourceConnectorRegistry,
    private readonly cache: ConnectorCacheService,
    private readonly breakers: ConnectorCircuitBreakerRegistry,
    private readonly rateLimiter: ConnectorRateLimiter,
    private readonly metrics: ConnectorMetrics,
  ) {}

  async execute(payload: ConnectorFetchJobPayload): Promise<ConnectorFetchResult> {
    const breaker = this.breakers.get(payload.connectorId);
    this.metrics.recordBreakerState(payload.connectorId, breaker.getState());
    if (!breaker.allowRequest()) {
      throw new ConnectorCircuitOpenError(payload.connectorId);
    }

    const includeBody = payload.includeBody === true || payload.purpose === 'body';
    const cacheKey = ConnectorCacheService.keyFromParts(
      payload.connectorId,
      payload.externalId,
      includeBody ? 'body' : 'metadata',
      payload.purpose,
    );

    const cached = await this.cache.getJson<{
      metadata: ConnectorFetchResult['metadata'];
      bodyBase64?: string;
      bodyContentType?: string;
    }>(payload.connectorId, cacheKey);

    if (cached !== null) {
      breaker.recordSuccess();
      return {
        externalId: cached.metadata.externalId,
        metadata: cached.metadata,
        ...(cached.bodyBase64 !== undefined
          ? {
              body: Buffer.from(cached.bodyBase64, 'base64'),
              bodyContentType: cached.bodyContentType,
            }
          : {}),
      };
    }

    await this.rateLimiter.wait(payload.connectorId);

    try {
      const connector = this.registry.get(payload.connectorId);
      this.metrics.recordFetch(payload.connectorId);
      const result = await connector.fetch({
        externalId: payload.externalId,
        includeBody,
      });

      const ttlMs =
        typeof payload.freshnessTtl === 'number' && payload.freshnessTtl > 0
          ? payload.freshnessTtl * 1000
          : undefined;

      await this.cache.setJson(
        payload.connectorId,
        cacheKey,
        {
          metadata: result.metadata,
          ...(result.body !== undefined
            ? {
                bodyBase64: result.body.toString('base64'),
                bodyContentType: result.bodyContentType,
              }
            : {}),
        },
        ttlMs,
      );

      breaker.recordSuccess();
      this.metrics.recordBreakerState(payload.connectorId, breaker.getState());
      return result;
    } catch (error) {
      if (error instanceof DomainError) {
        if (
          error.code === ErrorCode.UrlTargetBlocked ||
          error.code === ErrorCode.UrlSchemeNotAllowed
        ) {
          this.metrics.recordSsrfBlock(error.code);
        }
      }
      if (error instanceof ArxivRateLimitedError) {
        this.rateLimiter.penalize(payload.connectorId, error.retryAfterMs);
        breaker.recordFailure();
        throw new ConnectorRateLimitedJobError(error.message, error.retryAfterMs);
      }
      breaker.recordFailure();
      this.metrics.recordBreakerState(payload.connectorId, breaker.getState());
      if (error instanceof ConnectorJobError) {
        throw error;
      }
      throw new ConnectorJobError(
        error instanceof Error ? error.message : 'connector fetch failed',
        true,
      );
    }
  }
}
