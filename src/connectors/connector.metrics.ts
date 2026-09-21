import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import type { DiscoveryStatus } from '@prisma/client';

export interface ConnectorMetricsSnapshot {
  readonly fetchesByProvider: Readonly<Record<string, number>>;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly ssrfBlocks: number;
  readonly breakerStateByConnector: Readonly<Record<string, string>>;
  readonly candidatesByAdmissionState: Readonly<Record<string, number>>;
}

@Injectable()
export class ConnectorMetrics {
  private fetchesByProvider: Record<string, number> = {};
  private cacheHits = 0;
  private cacheMisses = 0;
  private ssrfBlocks = 0;
  private breakerStateByConnector: Record<string, string> = {};
  private candidatesByAdmissionState: Record<string, number> = {};

  constructor(private readonly logger: PlatformLogger) {}

  recordFetch(provider: string): void {
    this.fetchesByProvider[provider] = (this.fetchesByProvider[provider] ?? 0) + 1;
    this.logger.info({
      module: 'connectors',
      message: 'connector.fetch',
      provider,
    });
  }

  recordCacheHit(provider: string): void {
    this.cacheHits += 1;
    this.logger.info({
      module: 'connectors',
      message: 'connector.cache.hit',
      provider,
    });
  }

  recordCacheMiss(provider: string): void {
    this.cacheMisses += 1;
    this.logger.info({
      module: 'connectors',
      message: 'connector.cache.miss',
      provider,
    });
  }

  recordSsrfBlock(reason: string): void {
    this.ssrfBlocks += 1;
    this.logger.warn({
      module: 'connectors',
      message: 'connector.ssrf.blocked',
      reason,
    });
  }

  recordBreakerState(connectorId: string, state: string): void {
    this.breakerStateByConnector[connectorId] = state;
    this.logger.info({
      module: 'connectors',
      message: 'connector.circuit.state',
      connectorId,
      state,
    });
  }

  recordCandidateState(status: DiscoveryStatus | string): void {
    this.candidatesByAdmissionState[status] =
      (this.candidatesByAdmissionState[status] ?? 0) + 1;
    this.logger.info({
      module: 'connectors',
      message: 'discovery.candidate.state',
      status,
    });
  }

  snapshot(): ConnectorMetricsSnapshot {
    return {
      fetchesByProvider: { ...this.fetchesByProvider },
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      ssrfBlocks: this.ssrfBlocks,
      breakerStateByConnector: { ...this.breakerStateByConnector },
      candidatesByAdmissionState: { ...this.candidatesByAdmissionState },
    };
  }
}
