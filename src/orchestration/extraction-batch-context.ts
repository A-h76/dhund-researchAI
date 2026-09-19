import type { SearchCandidate } from '../retrieval/retrieval.port';
import {
  CONTEXT_ASSEMBLY_MAX_CHUNKS,
  CONTEXT_ASSEMBLY_TOKEN_BUDGET,
  assembleGroundedContext,
  type AssembledChatContext,
  type AssembledContextChunk,
} from './chat-context';

export {
  CONTEXT_ASSEMBLY_MAX_CHUNKS,
  CONTEXT_ASSEMBLY_TOKEN_BUDGET,
  type AssembledContextChunk,
};

export type AssembledBatchContext = AssembledChatContext & {
  readonly retrievalTraceId: string;
  readonly retrievalFingerprint: string;
};

/**
 * Batch / extraction context assembly (DHB-68).
 * Owns extraction batch assembly; shares token budget, max chunks, dedupe,
 * deterministic order, document diversity, and locator-preserving truncation
 * with DHB-62 via assembleGroundedContext.
 */
export function assembleBatchContext(
  hits: readonly SearchCandidate[],
  options: {
    readonly documentIds: readonly string[];
    readonly retrievalTraceId: string;
    readonly retrievalFingerprint: string;
    readonly maxChunks?: number;
    readonly tokenBudget?: number;
  },
): AssembledBatchContext {
  const assembled = assembleGroundedContext(hits, {
    documentIds: options.documentIds,
    maxChunks: options.maxChunks ?? CONTEXT_ASSEMBLY_MAX_CHUNKS,
    tokenBudget: options.tokenBudget ?? CONTEXT_ASSEMBLY_TOKEN_BUDGET,
  });

  return {
    ...assembled,
    retrievalTraceId: options.retrievalTraceId,
    retrievalFingerprint: options.retrievalFingerprint,
  };
}
