import { Module, OnModuleInit } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { CONNECTOR_IDS } from './connector.ids';
import { ConnectorCacheService } from './connector-cache.service';
import { ConnectorCircuitBreakerRegistry } from './connector-circuit-breaker';
import { ConnectorFetchService } from './connector-fetch.service';
import { ConnectorMetrics } from './connector.metrics';
import { ConnectorRateLimiter } from './connector-rate-limiter';
import { SourceConnectorRegistry } from './connector.registry';
import { DiscoveryAdmissionService } from './discovery-admission.service';
import { DiscoverySearchService } from './discovery-search.service';

@Module({
  imports: [PlatformModule],
  providers: [
    SourceConnectorRegistry,
    ConnectorCircuitBreakerRegistry,
    ConnectorRateLimiter,
    ConnectorMetrics,
    ConnectorCacheService,
    ConnectorFetchService,
    DiscoverySearchService,
    DiscoveryAdmissionService,
  ],
  exports: [
    SourceConnectorRegistry,
    ConnectorCircuitBreakerRegistry,
    ConnectorRateLimiter,
    ConnectorMetrics,
    ConnectorCacheService,
    ConnectorFetchService,
    DiscoverySearchService,
    DiscoveryAdmissionService,
  ],
})
export class ConnectorsModule implements OnModuleInit {
  constructor(private readonly rateLimiter: ConnectorRateLimiter) {}

  onModuleInit(): void {
    // arXiv asks for ~3s between requests.
    this.rateLimiter.configure(CONNECTOR_IDS.arxiv, { minIntervalMs: 3_000 });
  }
}
