import { DomainError, ErrorCode } from '../../src/platform/errors';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { RETRIEVAL_EMBED_MODEL_ID, RETRIEVAL_EMBED_MODEL_VERSION } from '../../src/retrieval/embed-identity';
import { RETRIEVAL_K_MAX, RETRIEVAL_OVER_FETCH_FACTOR } from '../../src/retrieval/over-fetch';
import { parseRetrievalSearchRequest } from '../../src/retrieval/parse-retrieval-request';
import { RETRIEVAL_QUALITY_MIN } from '../../src/retrieval/quality-filter';
import { toSearchResponse } from '../../src/retrieval/search-dto';
import { MemoryEvidenceLookup } from '../fixtures/memory-evidence-lookup';
import { MemoryRerank } from '../fixtures/memory-rerank';
import { MemoryRetrievalIndexStore } from '../fixtures/memory-retrieval-index';
import { MemoryRetrievalTraces } from '../fixtures/memory-retrieval-traces';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';
import { buildRetrievalService } from '../fixtures/memory-retrieval-service';

describe('DHB-57 evidence mapping, quality filter, degradation, traces', () => {
  it('maps existing evidence and keeps raw candidates without evidence refs', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const evidence = new MemoryEvidenceLookup();
    const traces = new MemoryRetrievalTraces();
    const projectId = generateId();
    const grounded = generateId();
    const raw = generateId();
    const evidenceId = generateId();
    const sourceId = generateId();
    store.annHits = [
      { chunkId: grounded, projectId, documentId: 'doc-g', text: 'trial', vectorScore: 0.2 },
      { chunkId: raw, projectId, documentId: 'doc-r', text: 'trial', vectorScore: 0.4 },
    ];
    evidence.evidence = [
      {
        id: evidenceId,
        chunkId: grounded,
        sourceId,
        stance: 'supports',
        qualityScore: 0.9,
        type: 'body_grounded',
        projectId,
      },
    ];
    evidence.sources = [{ id: sourceId, documentId: 'doc-g', projectId }];
    const built = buildRetrievalService({ store, fts, evidence, traces });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'trial',
      k: 5,
      correlationId: 'corr-map',
      runtimeRole: RuntimeRole.Api,
    });

    const groundedHit = result.hits.find((hit) => hit.chunkId === grounded);
    const rawHit = result.hits.find((hit) => hit.chunkId === raw);
    expect(groundedHit?.evidenceRefs).toEqual([evidenceId]);
    expect(groundedHit?.sourceId).toBe(sourceId);
    expect(groundedHit?.qualityAnnotation).toBe('body_grounded');
    expect(rawHit?.evidenceRefs).toEqual([]);
    expect(rawHit?.sourceId).toBe('doc-r');
    expect(rawHit?.qualityAnnotation).toBe('body_grounded');
    expect(traces.rows).toHaveLength(1);
    expect(traces.rows[0]?.queryFingerprint).toBe(result.trace.fingerprint);
    expect(traces.rows[0]?.embeddingModel).toBe(RETRIEVAL_EMBED_MODEL_ID);
    expect(traces.rows[0]?.embeddingVersion).toBe(RETRIEVAL_EMBED_MODEL_VERSION);
    expect(traces.rows[0]?.overFetchFactor).toBe(RETRIEVAL_OVER_FETCH_FACTOR);
  });

  it('drops unresolved and below-threshold evidence unless opted in', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const evidence = new MemoryEvidenceLookup();
    const projectId = generateId();
    const unresolvedId = generateId();
    const weakId = generateId();
    const metaId = generateId();
    store.annHits = [
      { chunkId: unresolvedId, projectId, documentId: 'd1', text: 'metformin' },
      { chunkId: weakId, projectId, documentId: 'd1', text: 'metformin' },
      { chunkId: metaId, projectId, documentId: 'd1', text: 'metformin' },
    ];
    evidence.evidence = [
      {
        id: generateId(),
        chunkId: unresolvedId,
        sourceId: 's1',
        stance: 'unresolved',
        qualityScore: 0.9,
        type: 'body_grounded',
      },
      {
        id: generateId(),
        chunkId: weakId,
        sourceId: 's1',
        stance: 'supports',
        qualityScore: RETRIEVAL_QUALITY_MIN - 0.2,
        type: 'body_grounded',
      },
      {
        id: generateId(),
        chunkId: metaId,
        sourceId: 's1',
        stance: 'supports',
        qualityScore: 0.8,
        type: 'metadata_only',
      },
    ];
    const built = buildRetrievalService({ store, fts, evidence });

    const dropped = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'metformin',
      k: 10,
      correlationId: 'corr-quality',
      runtimeRole: RuntimeRole.Api,
    });
    expect(dropped.hits.map((hit) => hit.chunkId)).toEqual([metaId]);
    expect(dropped.hits[0]?.qualityAnnotation).toBe('metadata_only');

    const opted = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'metformin',
      k: 10,
      includeUnresolved: true,
      correlationId: 'corr-optin',
      runtimeRole: RuntimeRole.Api,
    });
    expect(opted.hits.map((hit) => hit.chunkId).sort()).toEqual([metaId, unresolvedId].sort());
  });

  it('vector down returns results with fallbacksUsed vector', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const traces = new MemoryRetrievalTraces();
    store.annUnavailable = true;
    const projectId = generateId();
    fts.chunks = [{ chunkId: 'fts-1', projectId, documentId: 'd1', text: 'metformin adults' }];
    const built = buildRetrievalService({ store, fts, traces });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'metformin',
      k: 5,
      correlationId: 'corr-vector-down',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.hits.map((hit) => hit.chunkId)).toEqual(['fts-1']);
    expect(result.fallbacksUsed).toEqual(['vector']);
    expect(result.vectorHits).toEqual([]);
    expect(traces.rows).toHaveLength(1);
    expect(traces.rows[0]?.fallbacksUsed).toEqual(['vector']);
  });

  it('FTS down returns results with fallbacksUsed fts', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    store.annHits = [{ chunkId: 'v-1', projectId: 'p1', documentId: 'd1', text: 'metformin' }];
    fts.ftsUnavailable = true;
    const built = buildRetrievalService({ store, fts });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId: 'p1',
      query: 'metformin',
      k: 5,
      correlationId: 'corr-fts-down',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.hits.map((hit) => hit.chunkId)).toEqual(['v-1']);
    expect(result.fallbacksUsed).toEqual(['fts']);
  });

  it('reranker down records fallbacksUsed rerank and still returns results', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const rerank = new MemoryRerank();
    rerank.unavailable = true;
    const projectId = generateId();
    store.annHits = [{ chunkId: 'c1', projectId, documentId: 'd1', text: 'metformin' }];
    const built = buildRetrievalService({ store, fts, rerank });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'metformin',
      k: 5,
      correlationId: 'corr-rerank-down',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.hits).toHaveLength(1);
    expect(result.fallbacksUsed).toEqual(['rerank']);
    expect(result.rerankMethod).toBe('deterministic');
  });

  it('both retrieval arms down throw retrieval_unavailable after persisting a trace', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const traces = new MemoryRetrievalTraces();
    store.annUnavailable = true;
    fts.ftsUnavailable = true;
    const built = buildRetrievalService({ store, fts, traces });

    await expect(
      built.service.retrieve({
        orgId: generateId(),
        projectId: generateId(),
        query: 'metformin',
        k: 5,
        correlationId: 'corr-both-down',
        runtimeRole: RuntimeRole.Api,
      }),
    ).rejects.toMatchObject({
      name: DomainError.name,
      code: ErrorCode.RetrievalUnavailable,
    });
    expect(traces.rows).toHaveLength(1);
    expect(traces.rows[0]?.fallbacksUsed).toEqual(['vector', 'fts']);
    expect(traces.rows[0]?.body.orderedCandidateIds).toEqual([]);
  });

  it('DTO strips undeclared fields and exposes stageScores plus stats', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const projectId = generateId();
    store.annHits = [
      { chunkId: 'c1', projectId, documentId: 'd1', text: 'trial', vectorScore: 0.11 },
    ];
    const built = buildRetrievalService({ store, fts });
    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'trial',
      k: 1,
      correlationId: 'corr-dto',
      runtimeRole: RuntimeRole.Api,
    });
    const leaked = {
      ...result,
      secret: 'nope',
      hits: result.hits.map((hit) => ({ ...hit, extra: true })),
    };
    const dto = toSearchResponse(leaked);
    expect(Object.keys(dto).sort()).toEqual(['candidates', 'stats', 'trace']);
    expect(Object.keys(dto.candidates[0] ?? {}).sort()).toEqual([
      'chunkId',
      'documentId',
      'evidenceRefs',
      'qualityAnnotation',
      'score',
      'sourceId',
      'stageScores',
    ]);
    expect(Object.keys(dto.candidates[0]?.stageScores ?? {}).sort()).toEqual([
      'fts',
      'rerank',
      'rrf',
      'vector',
    ]);
    expect(dto.candidates[0]?.stageScores.vector).toBe(0.11);
    expect(dto.stats.latencyMs).toBe(result.latencyMs);
    expect(dto.stats.filteredRecallShortfall).toBe(result.filteredRecallShortfall);
    expect(dto.stats.fallbacksUsed).toEqual([]);
    expect(dto.trace).toEqual(result.trace);
    expect(JSON.stringify(dto)).not.toContain('secret');
    expect(JSON.stringify(dto)).not.toContain('extra');
    expect(JSON.stringify(dto)).not.toContain('generation');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect('ttftMs' in result).toBe(false);
  });

  it('enforces k/limit bounds', () => {
    expect(parseRetrievalSearchRequest({ query: 'q' }).k).toBe(10);
    expect(parseRetrievalSearchRequest({ query: 'q', k: 7 }).k).toBe(7);
    expect(parseRetrievalSearchRequest({ query: 'q', limit: 3 }).k).toBe(3);
    expect(() => parseRetrievalSearchRequest({ query: 'q', k: 0 })).toThrow(DomainError);
    expect(() => parseRetrievalSearchRequest({ query: 'q', k: RETRIEVAL_K_MAX + 1 })).toThrow(
      DomainError,
    );
    expect(() => parseRetrievalSearchRequest({ query: '   ' })).toThrow(DomainError);
  });
});
