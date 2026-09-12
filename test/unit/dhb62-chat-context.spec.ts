import { assembleChatContext } from '../../src/orchestration/chat-context';
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

describe('DHB-62 chat context assembly', () => {
  it('excludes raw candidates without Evidence (§5.26)', () => {
    const raw = hit({
      chunkId: generateId(),
      documentId: generateId(),
      text: 'raw candidate body',
      evidenceRefs: [],
      rerankScore: 0.99,
    });
    const grounded = hit({
      chunkId: generateId(),
      documentId: generateId(),
      text: 'grounded body',
      evidenceRefs: [generateId()],
      rerankScore: 0.1,
    });
    const assembled = assembleChatContext([raw, grounded]);
    expect(assembled.chunks).toHaveLength(1);
    expect(assembled.chunks[0]?.text).toBe('grounded body');
    expect(assembled.evidenceIds).toEqual(grounded.evidenceRefs);
  });

  it('orders deterministically by rerankScore then chunkId', () => {
    const doc = generateId();
    const a = hit({
      chunkId: '00000000-0000-7000-8000-00000000000a',
      documentId: doc,
      text: 'A',
      rerankScore: 0.5,
      evidenceRefs: [generateId()],
    });
    const b = hit({
      chunkId: '00000000-0000-7000-8000-00000000000b',
      documentId: generateId(),
      text: 'B',
      rerankScore: 0.9,
      evidenceRefs: [generateId()],
    });
    const c = hit({
      chunkId: '00000000-0000-7000-8000-00000000000c',
      documentId: generateId(),
      text: 'C',
      rerankScore: 0.5,
      evidenceRefs: [generateId()],
    });
    const assembled = assembleChatContext([a, b, c]);
    expect(assembled.chunks.map((chunk) => chunk.text)).toEqual(['B', 'A', 'C']);
  });

  it('truncates to token budget without dropping locator/evidence mapping', () => {
    const evidenceA = generateId();
    const evidenceB = generateId();
    const assembled = assembleChatContext(
      [
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
          text: 'x'.repeat(100),
          rerankScore: 0.5,
          evidenceRefs: [evidenceB],
        }),
      ],
      { tokenBudget: 10, maxChunks: 8 },
    );
    expect(assembled.truncated).toBe(true);
    expect(assembled.chunks.every((chunk) => chunk.locatorPreserved)).toBe(true);
    expect(assembled.evidenceIds).toEqual([evidenceA]);
    expect(assembled.documentContent).toContain(evidenceA);
    expect(assembled.documentContent).not.toContain(evidenceB);
  });

  it('deduplicates chunkIds', () => {
    const chunkId = generateId();
    const evidenceId = generateId();
    const assembled = assembleChatContext([
      hit({
        chunkId,
        documentId: generateId(),
        text: 'once',
        evidenceRefs: [evidenceId],
        rerankScore: 0.8,
      }),
      hit({
        chunkId,
        documentId: generateId(),
        text: 'once',
        evidenceRefs: [evidenceId],
        rerankScore: 0.7,
      }),
    ]);
    expect(assembled.chunks).toHaveLength(1);
  });
});
