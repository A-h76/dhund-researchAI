import { Global, Module } from '@nestjs/common';
import { OBJECT_STORAGE_SERVICE, type ObjectStorageService } from '../l0/ports';
import { PlatformModule } from '../platform/platform.module';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import { QUERY_EMBED } from '../retrieval/query-embed.port';
import { QUERY_RERANK } from '../retrieval/rerank.port';
import { AdapterRegistry } from './adapters/adapter-registry';
import { ProviderCircuitBreakerRegistry } from './adapters/circuit-breaker';
import { createLiveAdapters } from './adapters/live-adapters';
import { SdkOpenAiClient } from './adapters/openai/sdk-openai.client';
import { SdkVoyageClient } from './adapters/voyage/sdk-voyage.client';
import { BoundaryMetrics } from './boundary/boundary-metrics';
import { GatewayDataBoundary } from './boundary/gateway-data-boundary';
import { QueryEmbedAdapter } from './embed/query-embed.adapter';
import { GatewayService } from './gateway/gateway.service';
import { PolicyResolver } from './policy/policy-resolver';
import { PromptAssembler } from './policy/prompt-assembler';
import { QueryRerankAdapter } from './rerank/rerank.adapter';
import { DATA_BOUNDARY_CHECK, GATEWAY_SERVICE } from './tokens';

@Global()
@Module({
  imports: [PlatformModule],
  providers: [
    PolicyResolver,
    PromptAssembler,
    ProviderCircuitBreakerRegistry,
    SdkVoyageClient,
    SdkOpenAiClient,
    {
      provide: AdapterRegistry,
      useFactory: (
        voyageClient: SdkVoyageClient,
        openAiClient: SdkOpenAiClient,
        breakers: ProviderCircuitBreakerRegistry,
        logger: PlatformLogger,
        storage: ObjectStorageService,
      ) =>
        AdapterRegistry.forAdapters(
          createLiveAdapters({
            voyageClient,
            openAiClient,
            breakers,
            logger,
            storage,
          }),
        ),
      inject: [
        SdkVoyageClient,
        SdkOpenAiClient,
        ProviderCircuitBreakerRegistry,
        PlatformLogger,
        OBJECT_STORAGE_SERVICE,
      ],
    },
    GatewayService,
    BoundaryMetrics,
    GatewayDataBoundary,
    QueryEmbedAdapter,
    QueryRerankAdapter,
    { provide: DATA_BOUNDARY_CHECK, useExisting: GatewayDataBoundary },
    { provide: GATEWAY_SERVICE, useExisting: GatewayService },
    { provide: QUERY_EMBED, useExisting: QueryEmbedAdapter },
    { provide: QUERY_RERANK, useExisting: QueryRerankAdapter },
  ],
  exports: [GATEWAY_SERVICE, DATA_BOUNDARY_CHECK, GatewayService, QUERY_EMBED, QUERY_RERANK],
})
export class AiModule {}
