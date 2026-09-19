import {
  CONTEXT_ASSEMBLY_MAX_CHUNKS,
  CONTEXT_ASSEMBLY_TOKEN_BUDGET,
  assembleBatchContext,
} from '../../src/orchestration/extraction-batch-context';
import {
  CHAT_CONTEXT_MAX_CHUNKS,
  CHAT_CONTEXT_TOKEN_BUDGET,
  assembleChatContext,
} from '../../src/orchestration/chat-context';
import type { SearchCandidate } from '../../src/retrieval/retrieval.port';
import { generateId } from '../../src/platform/ids/uuid-v7';

function hit(
  overrides: Partial<SearchCandidate> & Pick<SearchCandidate, 'chunkId' | 'documentId' | 'text'>,
): SearchCandidate {
  return {
    projectId: generateId(),
    rrfScore: 0.5,
    rerankScore: 0.5,
    vectorScore: 0.1,
    ftsScore: null,
    sourceId: generateId(),
    evidenceRefs: [generateId()],
    qualityAnnotation: 'body_grounded',
    ...overrides,
  };
}

describe('DHB-68 batch context assembly (shared with DHB-62)', () => {
  it('shares token budget and max chunk defaults with chat assembly', () => {
    expect(CONTEXT_ASSEMBLY_MAX_CHUNKS).toBe(CHAT_CONTEXT_MAX_CHUNKS);
    expect(CONTEXT_ASSEMBLY_TOKEN_BUDGET).toBe(CHAT_CONTEXT_TOKEN_BUDGET);
  });

  it('filters to requested document ids while preserving locator/evidence mapping', () => {
    const docA = generateId();
    const docB = generateId();
    const evidenceA = generateId();
    const batch = assembleBatchContext(
      [
        hit({
          chunkId: generateId(),
          documentId: docA,
          text: 'A body',
          evidenceRefs: [evidenceA],
          rerankScore: 0.9,
        }),
        hit({
          chunkId: generateId(),
          documentId: docB,
          text: 'B body',
          evidenceRefs: [generateId()],
          rerankScore: 0.95,
        }),
      ],
      {
        documentIds: [docA],
        retrievalTraceId: generateId(),
        retrievalFingerprint: 'fp-1',
      },
    );
    expect(batch.chunks).toHaveLength(1);
    expect(batch.chunks[0]?.documentId).toBe(docA);
    expect(batch.chunks[0]?.locatorPreserved).toBe(true);
    expect(batch.evidenceIds).toEqual([evidenceA]);
    expect(batch.retrievalFingerprint).toBe('fp-1');
  });

  it('matches chat truncation rules — never drops locator/evidence on truncate', () => {
    const evidenceA = generateId();
    const evidenceB = generateId();
    const hits = [
      hit({
        chunkId: generateId(),
        documentId: generateId(),
        text: 'short',
        rerankScore: 1,
        evidenceRefs: [evidenceA],
      }),
      hit({
        chunkId: generateId(),
        documentId: generateId(),
        text: 'x'.repeat(20_000),
        rerankScore: 0.5,
        evidenceRefs: [evidenceB],
      }),
    ];
    const chat = assembleChatContext(hits, { tokenBudget: 50 });
    const batch = assembleBatchContext(hits, {
      documentIds: hits.map((h) => h.documentId),
      retrievalTraceId: generateId(),
      retrievalFingerprint: 'fp',
      tokenBudget: 50,
    });
    expect(batch.truncated).toBe(true);
    expect(chat.truncated).toBe(true);
    expect(batch.chunks.every((c) => c.locatorPreserved)).toBe(true);
    expect(batch.chunks[0]?.evidenceIds).toEqual(chat.chunks[0]?.evidenceIds);
  });
});
