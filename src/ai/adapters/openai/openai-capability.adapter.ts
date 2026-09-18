import { isInteractiveCapability } from '../../policy/capability-routing';
import { computeInputFingerprint } from '../../gateway/input-fingerprint';
import type { CapabilityInvokeResult, OcrPage } from '../../gateway/gateway.types';
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
              ...(input.onToken !== undefined ? { onToken: input.onToken } : {}),
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
      return { capability: 'OCR', ...parseOcrPayload(text), ...base };
    case 'EMBED':
      throw new AdapterError('terminal', 'OpenAI adapter does not handle EMBED');
    default: {
      const _exhaustive: never = input.request;
      throw new Error(`Unhandled capability: ${String(_exhaustive)}`);
    }
  }
}

function parseOcrPayload(text: string): {
  text: string;
  pages: readonly OcrPage[];
  meanConfidence: number;
} {
  const structured = parseStructuredOcr(text);
  if (structured !== null) {
    return structured;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { text: '', pages: [], meanConfidence: 0 };
  }
  return {
    text: trimmed,
    meanConfidence: 0.5,
    pages: [
      {
        page: 1,
        confidence: 0.5,
        blocks: [{ text: trimmed, confidence: 0.5 }],
      },
    ],
  };
}

function parseStructuredOcr(text: string): {
  text: string;
  pages: readonly OcrPage[];
  meanConfidence: number;
} | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (match === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (typeof parsed !== 'object' || parsed === null || !('pages' in parsed)) {
      return null;
    }
    const pagesValue = (parsed as { pages: unknown }).pages;
    if (!Array.isArray(pagesValue)) {
      return null;
    }
    const pages: OcrPage[] = [];
    for (const entry of pagesValue) {
      const page = asOcrPage(entry);
      if (page === null) {
        return null;
      }
      pages.push(page);
    }
    const texts = pages.flatMap((page) => page.blocks.map((block) => block.text));
    const meanConfidence =
      pages.length === 0
        ? 0
        : pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length;
    return { text: texts.join('\n'), pages, meanConfidence };
  } catch {
    return null;
  }
}

function asOcrPage(value: unknown): OcrPage | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.page !== 'number' || typeof record.confidence !== 'number') {
    return null;
  }
  if (!Array.isArray(record.blocks)) {
    return null;
  }
  const blocks: Array<{ text: string; confidence: number }> = [];
  for (const block of record.blocks) {
    if (typeof block !== 'object' || block === null) {
      return null;
    }
    const blockRecord = block as Record<string, unknown>;
    if (typeof blockRecord.text !== 'string' || typeof blockRecord.confidence !== 'number') {
      return null;
    }
    blocks.push({ text: blockRecord.text, confidence: blockRecord.confidence });
  }
  return { page: record.page, confidence: record.confidence, blocks };
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
