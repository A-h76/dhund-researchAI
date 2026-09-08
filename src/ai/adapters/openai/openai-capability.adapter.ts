import { isInteractiveCapability } from '../../policy/capability-routing';
import { computeInputFingerprint } from '../../gateway/input-fingerprint';
import type { CapabilityInvokeResult } from '../../gateway/gateway.types';
import type { AdapterInvokeInput, CapabilityAdapter } from '../adapter.port';
import type { AdapterInvokeOutcome } from '../adapter-outcome';
import { AdapterError } from '../adapter.errors';
import type { ProviderCircuitBreakerRegistry } from '../circuit-breaker';
import { walkFallbackChain } from '../fallback-chain';
import { PlatformLogger } from '../../../platform/logging/platform-logger.service';
import { buildDeterministicResult } from '../deterministic/deterministic-result';
import type { OpenAiClient } from './openai-client';
import type { AiCapability } from '../../capability';

const OPENAI_MICROS_PER_TOKEN = 15;

export class OpenAiCapabilityAdapter implements CapabilityAdapter {
  constructor(
    readonly capability: AiCapability,
    private readonly client: OpenAiClient,
    private readonly breakers: ProviderCircuitBreakerRegistry,
    private readonly logger: PlatformLogger,
  ) {}

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    if (input.request.capability !== this.capability) {
      throw new AdapterError(
        'terminal',
        `OpenAiCapabilityAdapter(${this.capability}) received ${input.request.capability}`,
      );
    }

    const model = input.policy.modelId;
    const stream = isInteractiveCapability(this.capability);

    return walkFallbackChain(
      [
        {
          provider: 'openai',
          model,
          method: 'llm',
          invoke: async () => {
            const response = await this.client.complete({
              model,
              systemPrompt: input.payload.systemPrompt,
              userPayload: input.payload.userPayload,
              stream,
            });
            const costMicros =
              (response.tokensIn + response.tokensOut) * OPENAI_MICROS_PER_TOKEN;
            const result = parseCapabilityResult(input, response.text, {
              latencyMs: response.latencyMs,
              tokensIn: response.tokensIn,
              tokensOut: response.tokensOut,
              costMicros,
            });
            return {
              result,
              tokensIn: response.tokensIn,
              tokensOut: response.tokensOut,
              costMicros,
              latencyMs: response.latencyMs,
            };
          },
        },
        {
          provider: 'openai',
          model,
          method: 'deterministic',
          skipBreaker: true,
          invoke: async () => {
            const result = buildDeterministicResult(input);
            return {
              result,
              tokensIn: 0,
              tokensOut: 0,
              costMicros: 0,
              latencyMs: 1,
            };
          },
        },
      ],
      this.breakers,
      this.logger,
    );
  }
}

function parseCapabilityResult(
  input: AdapterInvokeInput,
  text: string,
  metrics: CapabilityInvokeResult['metrics'],
): CapabilityInvokeResult {
  const base = {
    inputFingerprint: computeInputFingerprint(input.request),
    promptVersion: input.policy.promptVersion,
    provider: input.policy.provider,
    model: input.policy.modelId,
    metrics,
  };

  switch (input.request.capability) {
    case 'CHAT':
      return { capability: 'CHAT', text, ...base };
    case 'RERANK':
      return {
        capability: 'RERANK',
        scores: parseRerankScores(text, input.request.candidates.length),
        ...base,
      };
    case 'AUTOCOMPLETE':
      return { capability: 'AUTOCOMPLETE', completion: text, ...base };
    case 'EXTRACT_CELL':
      return { capability: 'EXTRACT_CELL', value: text.trim(), ...base };
    case 'SCREENING':
      return { capability: 'SCREENING', decision: parseScreening(text), ...base };
    case 'STANCE':
      return { capability: 'STANCE', stance: parseStance(text), ...base };
    case 'SYNTHESIS':
      return { capability: 'SYNTHESIS', text, ...base };
    case 'OCR':
      return { capability: 'OCR', text, ...base };
    case 'EMBED':
      throw new AdapterError('terminal', 'OpenAI adapter does not handle EMBED');
    default: {
      const _exhaustive: never = input.request;
      throw new Error(`Unhandled capability: ${String(_exhaustive)}`);
    }
  }
}

function parseRerankScores(text: string, expected: number): number[] {
  const match = text.match(/\[[^\]]*]/);
  if (match !== null) {
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'number')) {
        const scores = parsed.slice(0, expected);
        while (scores.length < expected) {
          scores.push(0);
        }
        return scores;
      }
    } catch {
      // fall through to zeros
    }
  }

  return Array.from({ length: expected }, () => 0);
}

function parseScreening(text: string): 'include' | 'exclude' | 'uncertain' {
  const normalized = text.trim().toLowerCase();
  if (normalized.includes('include')) {
    return 'include';
  }
  if (normalized.includes('exclude')) {
    return 'exclude';
  }
  return 'uncertain';
}

function parseStance(text: string): 'support' | 'oppose' | 'neutral' {
  const normalized = text.trim().toLowerCase();
  if (normalized.includes('support')) {
    return 'support';
  }
  if (normalized.includes('oppose')) {
    return 'oppose';
  }
  return 'neutral';
}
