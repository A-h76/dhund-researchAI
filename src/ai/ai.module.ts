import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import { AdapterRegistry } from './adapters/adapter-registry';
import { ProviderCircuitBreakerRegistry } from './adapters/circuit-breaker';
import { createLiveAdapters } from './adapters/live-adapters';
import { SdkOpenAiClient } from './adapters/openai/sdk-openai.client';
import { SdkVoyageClient } from './adapters/voyage/sdk-voyage.client';
import { NoopDataBoundary } from './boundary/noop-data-boundary';
import { GatewayService } from './gateway/gateway.service';
import { PolicyResolver } from './policy/policy-resolver';
import { PromptAssembler } from './policy/prompt-assembler';
import { DATA_BOUNDARY_CHECK, GATEWAY_SERVICE } from './tokens';

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
      ) =>
        AdapterRegistry.forAdapters(
          createLiveAdapters({
            voyageClient,
            openAiClient,
            breakers,
            logger,
          }),
        ),
      inject: [
        SdkVoyageClient,
        SdkOpenAiClient,
        ProviderCircuitBreakerRegistry,
        PlatformLogger,
      ],
    },
    GatewayService,
    NoopDataBoundary,
    { provide: DATA_BOUNDARY_CHECK, useExisting: NoopDataBoundary },
    { provide: GATEWAY_SERVICE, useExisting: GatewayService },
  ],
  exports: [GATEWAY_SERVICE, DATA_BOUNDARY_CHECK, GatewayService],
})
export class AiModule {}
