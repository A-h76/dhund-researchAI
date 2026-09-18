import type { SearchCandidate } from '../retrieval/retrieval.port';

export const CHAT_CONTEXT_MAX_CHUNKS = 8;
export const CHAT_CONTEXT_TOKEN_BUDGET = 3_000;

export interface AssembledContextChunk {
  readonly chunkId: string;
  readonly documentId: string;
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly sourceId: string;
  readonly qualityAnnotation: 'body_grounded' | 'metadata_only';
  readonly locatorPreserved: true;
}

export interface AssembledChatContext {
  readonly documentContent: string;
  readonly chunks: readonly AssembledContextChunk[];
  readonly evidenceIds: readonly string[];
  readonly truncated: boolean;
}

/**
 * Interactive context assembly (DHB-62). Shared rules with DHB-68:
 * token budget, max chunks, dedupe, deterministic order, document diversity,
 * truncation that never silently drops locator/evidence mapping.
 *
 * Raw candidates without Evidence rows are excluded (§5.26).
 */
export function assembleChatContext(
  hits: readonly SearchCandidate[],
  options: {
    readonly maxChunks?: number;
    readonly tokenBudget?: number;
  } = {},
): AssembledChatContext {
  const maxChunks = options.maxChunks ?? CHAT_CONTEXT_MAX_CHUNKS;
  const tokenBudget = options.tokenBudget ?? CHAT_CONTEXT_TOKEN_BUDGET;

  const grounded = hits.filter((hit) => hit.evidenceRefs.length > 0);
  const ordered = [...grounded].sort((a, b) => {
    if (b.rerankScore !== a.rerankScore) {
      return b.rerankScore - a.rerankScore;
    }
    return a.chunkId.localeCompare(b.chunkId);
  });

  const deduped: SearchCandidate[] = [];
  const seenChunks = new Set<string>();
  for (const hit of ordered) {
    if (seenChunks.has(hit.chunkId)) {
      continue;
    }
    seenChunks.add(hit.chunkId);
    deduped.push(hit);
  }

  const diversified = diversifyByDocument(deduped);
  const selected: AssembledContextChunk[] = [];
  let tokensUsed = 0;
  let truncated = diversified.length > maxChunks;

  for (const hit of diversified) {
    if (selected.length >= maxChunks) {
      truncated = true;
      break;
    }
    const estimate = estimateTokens(hit.text);
    if (tokensUsed + estimate > tokenBudget && selected.length > 0) {
      truncated = true;
      break;
    }
    selected.push({
      chunkId: hit.chunkId,
      documentId: hit.documentId,
      text: hit.text,
      evidenceIds: [...hit.evidenceRefs],
      sourceId: hit.sourceId,
      qualityAnnotation: hit.qualityAnnotation,
      locatorPreserved: true,
    });
    tokensUsed += estimate;
  }

  const evidenceIds = uniqueStable(selected.flatMap((chunk) => chunk.evidenceIds));
  const documentContent = selected
    .map(
      (chunk, index) =>
        `[${index + 1}] doc=${chunk.documentId} chunk=${chunk.chunkId} evidence=${chunk.evidenceIds.join(',')}\n${chunk.text}`,
    )
    .join('\n\n');

  return {
    documentContent,
    chunks: selected,
    evidenceIds,
    truncated,
  };
}

function diversifyByDocument(hits: readonly SearchCandidate[]): SearchCandidate[] {
  const byDoc = new Map<string, SearchCandidate[]>();
  for (const hit of hits) {
    const bucket = byDoc.get(hit.documentId) ?? [];
    bucket.push(hit);
    byDoc.set(hit.documentId, bucket);
  }
  const queues = [...byDoc.values()];
  const out: SearchCandidate[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined) {
        out.push(next);
        progressed = true;
      }
    }
  }
  return out;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function uniqueStable(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
