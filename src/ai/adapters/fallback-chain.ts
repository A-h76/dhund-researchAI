import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import { assertIntegerMicros } from '../../platform/money/micros';
import type { PolicyProvider } from '../policy/policy.types';
import type { CapabilityInvokeResult } from '../gateway/gateway.types';
import type { AdapterAttemptOutcome, AdapterInvokeOutcome } from './adapter-outcome';
import { classifyProviderError } from './adapter.errors';
import type { ProviderCircuitBreakerRegistry } from './circuit-breaker';

export interface FallbackHopResult {
  readonly result: CapabilityInvokeResult;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMicros: number;
  readonly latencyMs: number;
}

export interface FallbackHop {
  readonly provider: PolicyProvider;
  readonly model: string;
  readonly method: 'llm' | 'deterministic';
  readonly skipBreaker?: boolean;
  invoke(): Promise<FallbackHopResult>;
}

export async function walkFallbackChain(
  hops: readonly FallbackHop[],
  breakers: ProviderCircuitBreakerRegistry,
  logger?: PlatformLogger,
): Promise<AdapterInvokeOutcome> {
  const attempts: AdapterAttemptOutcome[] = [];

  for (const [index, hop] of hops.entries()) {
    const breaker = hop.skipBreaker === true ? undefined : breakers.get(hop.provider);
    if (breaker !== undefined && !breaker.allowRequest()) {
      attempts.push({
        provider: hop.provider,
        model: hop.model,
        status: 'failed',
        error: 'circuit_open',
        latencyMs: 0,
        costMicros: 0,
      });
      continue;
    }

    const started = Date.now();
    try {
      const hopResult = await hop.invoke();
      assertIntegerMicros(hopResult.costMicros);
      breaker?.recordSuccess();
      attempts.push({
        provider: hop.provider,
        model: hop.model,
        status: 'ok',
        latencyMs: hopResult.latencyMs,
        costMicros: hopResult.costMicros,
      });

      if (index > 0) {
        logger?.info({
          module: 'ai.adapters',
          message: 'ai.fallback.used',
          provider: hop.provider,
          hopIndex: index + 1,
          method: hop.method,
        });
      }

      return {
        status: 'ok',
        method: hop.method,
        result: hopResult.result,
        attempts,
        tokensIn: hopResult.tokensIn,
        tokensOut: hopResult.tokensOut,
        costMicros: hopResult.costMicros,
      };
    } catch (error) {
      const classified = classifyProviderError(error);
      breaker?.recordFailure();
      attempts.push({
        provider: hop.provider,
        model: hop.model,
        status: 'failed',
        error: classified.kind,
        latencyMs: Date.now() - started,
        costMicros: 0,
      });
    }
  }

  return {
    status: 'failed',
    method: hops[hops.length - 1]?.method ?? 'llm',
    attempts,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
  };
}
