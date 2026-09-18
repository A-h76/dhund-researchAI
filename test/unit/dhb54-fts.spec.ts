import { RetrievalArmUnavailableError } from '../../src/l0/ports/retrieval-index.port';
import type { PlatformLogger } from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { LexicalSearch } from '../../src/retrieval/lexical-search';
import { TrigramIdentityLookup } from '../../src/retrieval/trigram-identity';
import { RetrievalMetrics } from '../../src/retrieval/retrieval.metrics';
import { MemoryIdentityLookupStore } from '../fixtures/memory-identity-lookup';
import { MemoryRetrievalIndexStore } from '../fixtures/memory-retrieval-index';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

describe('DHB-54 GAP-FTS-01 lexical and trigram identity', () => {
  it('serves lexical hits from search_vector-backed FTS and scopes by project_id', async () => {
    const store = new MemoryRetrievalIndexStore();
    const projectId = generateId();
    store.chunks = [
      {
        chunkId: generateId(),
        projectId,
        documentId: generateId(),
        text: 'randomized controlled trial outcomes',
      },
      {
        chunkId: generateId(),
        projectId: generateId(),
        documentId: generateId(),
        text: 'randomized controlled trial outcomes',
      },
    ];
    const search = new LexicalSearch(store, new RetrievalMetrics(stubLogger()));
    const hits = await search.search({ projectId }, 'randomized', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.projectId).toBe(projectId);
  });

  it('surfaces FTS unavailability explicitly', async () => {
    const store = new MemoryRetrievalIndexStore();
    store.ftsUnavailable = true;
    const metrics = new RetrievalMetrics(stubLogger());
    const search = new LexicalSearch(store, metrics);
    await expect(search.search({ projectId: generateId() }, 'trial', 5)).rejects.toBeInstanceOf(
      RetrievalArmUnavailableError,
    );
    expect(metrics.snapshot().ftsUnavailable).toBe(1);
  });

  it('E-2: a trigram title match produces a pending MergeCandidate and never a merge', async () => {
    const store = new MemoryIdentityLookupStore();
    const candidateWorkId = generateId();
    const existingWorkId = generateId();
    store.canonicalWorks = [
      { workId: candidateWorkId, title: 'Metformin in Adults' },
      { workId: existingWorkId, title: 'Metformin in Adults' },
    ];
    const lookup = new TrigramIdentityLookup(store);
    const proposed = await lookup.proposeMergeCandidatesByTitle(
      candidateWorkId,
      'Metformin in Adults',
      10,
    );

    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toEqual({
      id: proposed[0]?.id,
      candidateWorkId,
      existingWorkId,
      matchType: 'fuzzy_title',
      status: 'pending',
    });
    expect(store.mergeCandidates.every((row) => row.status === 'pending')).toBe(true);
    expect(store.mergeCandidates.every((row) => row.matchType === 'fuzzy_title')).toBe(true);
    expect(JSON.stringify(store)).not.toMatch(/workRelationship|merged/);
  });
});
