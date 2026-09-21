import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTOR_SPINE_STORE,
  type ConnectorSpineStore,
} from '../l0/ports/connector-spine.port';
import { generateId } from '../platform/ids';
import { DomainError, ErrorCode } from '../platform/errors';
import { ArxivRateLimitedError } from './adapters/arxiv.connector';
import { ConnectorCircuitBreakerRegistry } from './connector-circuit-breaker';
import {
  ConnectorCircuitOpenError,
  ConnectorJobError,
  ConnectorRateLimitedJobError,
} from './connector-job.errors';
import { ConnectorMetrics } from './connector.metrics';
import { ConnectorRateLimiter } from './connector-rate-limiter';
import { SourceConnectorRegistry } from './connector.registry';
import type { ConnectorSearchHit } from './source-connector';

export interface DiscoverySearchJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly connectorIds: readonly string[];
  readonly query: string;
  readonly correlationId: string;
  readonly queryId?: string;
  readonly limit?: number;
}

export interface DiscoverySearchResult {
  readonly queryId: string;
  readonly candidates: readonly {
    readonly id: string;
    readonly connectorId: string;
    readonly externalId: string;
    readonly status: string;
  }[];
}

@Injectable()
export class DiscoverySearchService {
  constructor(
    private readonly registry: SourceConnectorRegistry,
    @Inject(CONNECTOR_SPINE_STORE) private readonly spine: ConnectorSpineStore,
    private readonly breakers: ConnectorCircuitBreakerRegistry,
    private readonly rateLimiter: ConnectorRateLimiter,
    private readonly metrics: ConnectorMetrics,
  ) {}

  async execute(payload: DiscoverySearchJobPayload): Promise<DiscoverySearchResult> {
    const queryId = payload.queryId ?? generateId();
    const candidates: DiscoverySearchResult['candidates'][number][] = [];

    for (const connectorId of payload.connectorIds) {
      if (!this.registry.has(connectorId)) {
        throw new ConnectorJobError(`Unknown connector: ${connectorId}`, false);
      }

      const breaker = this.breakers.get(connectorId);
      this.metrics.recordBreakerState(connectorId, breaker.getState());
      if (!breaker.allowRequest()) {
        throw new ConnectorCircuitOpenError(connectorId);
      }

      await this.rateLimiter.wait(connectorId);

      let hits: readonly ConnectorSearchHit[];
      try {
        this.metrics.recordFetch(connectorId);
        hits = await this.registry.get(connectorId).search({
          query: payload.query,
          limit: payload.limit,
        });
        breaker.recordSuccess();
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
          this.rateLimiter.penalize(connectorId, error.retryAfterMs);
          breaker.recordFailure();
          throw new ConnectorRateLimitedJobError(error.message, error.retryAfterMs);
        }
        breaker.recordFailure();
        this.metrics.recordBreakerState(connectorId, breaker.getState());
        throw new ConnectorJobError(
          error instanceof Error ? error.message : 'discovery search failed',
          true,
        );
      }

      for (const hit of hits) {
        const row = await this.spine.upsertDiscoveryCandidate({
          projectId: payload.projectId,
          queryId,
          connectorId,
          hit,
        });
        this.metrics.recordCandidateState(row.status);
        candidates.push({
          id: row.id,
          connectorId: row.connectorId,
          externalId: row.externalId,
          status: row.status,
        });
      }
    }

    return { queryId, candidates };
  }
}
