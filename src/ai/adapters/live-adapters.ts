import { AI_CAPABILITIES, type AiCapability } from '../capability';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import type { CapabilityAdapter } from './adapter.port';
import type { ProviderCircuitBreakerRegistry } from './circuit-breaker';
import { OpenAiCapabilityAdapter } from './openai/openai-capability.adapter';
import type { OpenAiClient } from './openai/openai-client';
import { VoyageEmbedAdapter } from './voyage/voyage-embed.adapter';
import type { VoyageEmbedClient } from './voyage/voyage-client';

export function createLiveAdapters(deps: {
  readonly voyageClient: VoyageEmbedClient;
  readonly openAiClient: OpenAiClient;
  readonly breakers: ProviderCircuitBreakerRegistry;
  readonly logger: PlatformLogger;
}): readonly CapabilityAdapter[] {
  const openaiAdapters = AI_CAPABILITIES.filter(
    (capability): capability is Exclude<AiCapability, 'EMBED'> => capability !== 'EMBED',
  ).map(
    (capability) =>
      new OpenAiCapabilityAdapter(
        capability,
        deps.openAiClient,
        deps.breakers,
        deps.logger,
      ),
  );

  return [
    new VoyageEmbedAdapter(deps.voyageClient, deps.breakers, deps.logger),
    ...openaiAdapters,
  ];
}
