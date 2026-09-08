import { EMBED_DIMENSION } from '../../policy/embed-policy.constants';
import { PlatformLogger } from '../../../platform/logging/platform-logger.service';
import { computeInputFingerprint } from '../../gateway/input-fingerprint';
import type { CapabilityInvokeResult } from '../../gateway/gateway.types';
import type { AdapterInvokeInput, CapabilityAdapter } from '../adapter.port';
import type { AdapterInvokeOutcome } from '../adapter-outcome';
import { AdapterError } from '../adapter.errors';
import type { ProviderCircuitBreakerRegistry } from '../circuit-breaker';
import { walkFallbackChain } from '../fallback-chain';
import type { VoyageEmbedClient } from './voyage-client';

const VOYAGE_MICROS_PER_TOKEN = 10;

export class VoyageEmbedAdapter implements CapabilityAdapter {
  readonly capability = 'EMBED' as const;

  constructor(
    private readonly client: VoyageEmbedClient,
    private readonly breakers: ProviderCircuitBreakerRegistry,
    private readonly logger: PlatformLogger,
  ) {}

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    if (input.request.capability !== 'EMBED') {
      throw new AdapterError('terminal', 'VoyageEmbedAdapter received a non-EMBED request');
    }

    const request = input.request;
    const model = input.policy.modelId;

    return walkFallbackChain(
      [
        {
          provider: 'voyage',
          model,
          method: 'llm',
          invoke: async () => {
            const response = await this.client.embed({
              model,
              texts: request.texts,
              inputType: request.inputType,
            });

            for (const vector of response.vectors) {
              if (vector.length !== EMBED_DIMENSION) {
                throw new AdapterError(
                  'terminal',
                  `EMBED dimension mismatch: expected ${String(EMBED_DIMENSION)}`,
                );
              }
            }

            const costMicros = response.tokensIn * VOYAGE_MICROS_PER_TOKEN;
            const result: CapabilityInvokeResult = {
              capability: 'EMBED',
              vectors: response.vectors,
              inputType: request.inputType,
              inputFingerprint: computeInputFingerprint(request),
              promptVersion: input.policy.promptVersion,
              provider: input.policy.provider,
              model,
              metrics: {
                latencyMs: response.latencyMs,
                tokensIn: response.tokensIn,
                tokensOut: 0,
                costMicros,
              },
            };

            return {
              result,
              tokensIn: response.tokensIn,
              tokensOut: 0,
              costMicros,
              latencyMs: response.latencyMs,
            };
          },
        },
      ],
      this.breakers,
      this.logger,
    );
  }
}
