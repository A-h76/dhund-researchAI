import { EMBED_DIMENSION } from '../../policy/embed-policy.constants';
import { computeInputFingerprint } from '../../gateway/input-fingerprint';
import type { CapabilityInvokeResult } from '../../gateway/gateway.types';
import type { AdapterInvokeInput } from '../adapter.port';

export function buildDeterministicResult(
  input: AdapterInvokeInput,
): CapabilityInvokeResult {
  const base = {
    inputFingerprint: computeInputFingerprint(input.request),
    promptVersion: input.policy.promptVersion,
    provider: input.policy.provider,
    model: input.policy.modelId,
    metrics: {
      latencyMs: 1,
      tokensIn: 0,
      tokensOut: 0,
      costMicros: 0,
    },
  };

  switch (input.request.capability) {
    case 'CHAT':
      return { capability: 'CHAT', text: 'deterministic-fallback', ...base };
    case 'EMBED':
      return {
        capability: 'EMBED',
        vectors: input.request.texts.map(() =>
          Array.from({ length: EMBED_DIMENSION }, () => 0),
        ),
        inputType: input.request.inputType,
        ...base,
      };
    case 'RERANK':
      return {
        capability: 'RERANK',
        scores: input.request.candidates.map(() => 0),
        ...base,
      };
    case 'AUTOCOMPLETE':
      return {
        capability: 'AUTOCOMPLETE',
        completion: `${input.request.prefix}`,
        ...base,
      };
    case 'EXTRACT_CELL':
      return { capability: 'EXTRACT_CELL', value: '', ...base };
    case 'SCREENING':
      return { capability: 'SCREENING', decision: 'uncertain', ...base };
    case 'STANCE':
      return { capability: 'STANCE', stance: 'neutral', ...base };
    case 'SYNTHESIS':
      return { capability: 'SYNTHESIS', text: '', ...base };
    case 'OCR':
      return { capability: 'OCR', text: '', pages: [], meanConfidence: 0, ...base };
    case 'EVIDENCE_EXTRACT':
      return { capability: 'EVIDENCE_EXTRACT', candidates: [], ...base };
    default: {
      const _exhaustive: never = input.request;
      throw new Error(`Unhandled capability: ${String(_exhaustive)}`);
    }
  }
}
