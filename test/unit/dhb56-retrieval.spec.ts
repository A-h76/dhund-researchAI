import type { IGatewayService } from '../../src/ai/gateway/gateway.port';
import type { GatewayResult } from '../../src/ai/gateway/gateway.types';
import { QueryRerankAdapter } from '../../src/ai/rerank/rerank.adapter';
import { FILTERED_RECALL_SHORTFALL_THRESHOLD } from '../../src/retrieval/filtered-recall';
import { authzRecheck } from '../../src/retrieval/authz-recheck';
import { bm25Scores } from '../../src/retrieval/bm25';
import { AnnSearch } from '../../src/retrieval/ann-search';
import { LexicalSearch } from '../../src/retrieval/lexical-search';
import { ineligibleCountAtFusionBoundary, fuseRrf, RRF_K } from '../../src/retrieval/rrf';
import type { RetrievalCandidate } from '../../src/retrieval/retrieval.port';
import { RetrievalMetrics } from '../../src/retrieval/retrieval.metrics';
import { RetrievalService } from '../../src/retrieval/retrieval.service';
import type { PlatformLogger } from '../../src/platform/logging';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { buildTestAppConfig } from '../fixtures/app-config.fixture';
import { MemoryQueryEmbed } from '../fixtures/memory-query-embed';
import { MemoryRerank } from '../fixtures/memory-rerank';
import { MemoryRetrievalIndexStore } from '../fixtures/memory-retrieval-index';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

function hit(
  chunkId: string,
  projectId: string,
  text: string,
  arm: RetrievalCandidate['arm'] = 'vector',
): RetrievalCandidate {
  return { chunkId, projectId, documentId: `doc-${chunkId}`, text, arm };
}

function service(input: {
  readonly store: MemoryScopedStore;
  readonly fts: MemoryRetrievalIndexStore;
  readonly rerank?: MemoryRerank;
  readonly metrics?: RetrievalMetrics;
}): { service: RetrievalService; rerank: MemoryRerank; metrics: RetrievalMetrics } {
  const metrics = input.metrics ?? new RetrievalMetrics(stubLogger());
  const rerank = input.rerank ?? new MemoryRerank();
  return {
    rerank,
    metrics,
    service: new RetrievalService(
      new MemoryQueryEmbed(),
      new AnnSearch(input.store, buildTestAppConfig(), metrics),
      new LexicalSearch(input.fts, metrics),
      rerank,
      metrics,
    ),
  };
}

describe('DHB-56 RRF fusion, rerank, and authz re-check', () => {
  it('produces the correct RRF order for known arm rankings', () => {
    const projectId = 'p1';
    const fused = fuseRrf(
      [hit('c1', projectId, 'alpha'), hit('c2', projectId, 'beta')],
      [hit('c2', projectId, 'beta', 'fts'), hit('c3', projectId, 'gamma', 'fts')],
    );
    expect(RRF_K).toBe(60);
    expect(fused.map((candidate) => candidate.chunkId)).toEqual(['c2', 'c1', 'c3']);
    expect(fused[0]?.rrfScore).toBeCloseTo(1 / 61 + 1 / 62);
    expect(fused[1]?.rrfScore).toBeCloseTo(1 / 61);
    expect(fused[2]?.rrfScore).toBeCloseTo(1 / 62);
  });

  it('fusion input contains zero ineligible candidates', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const projectId = generateId();
    store.annHits = [
      { chunkId: 'v1', projectId, documentId: 'd1', text: 'metformin' },
      { chunkId: 'v2', projectId, documentId: 'd1', text: 'adults' },
    ];
    fts.chunks = [{ chunkId: 'f1', projectId, documentId: 'd1', text: 'metformin adults' }];
    const built = service({ store, fts });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'metformin adults',
      k: 5,
      correlationId: 'corr-fusion',
      runtimeRole: RuntimeRole.Api,
    });

    expect(ineligibleCountAtFusionBoundary(result.vectorHits, result.ftsHits)).toBe(0);
    expect(result.vectorHits.map((item) => item.chunkId)).toEqual(['v1', 'v2']);
    expect(result.ftsHits.map((item) => item.chunkId)).toEqual(['f1']);
  });

  it('Gateway RERANK improves ordering and records one execution id', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const rerank = new MemoryRerank();
    const projectId = generateId();
    store.annHits = [
      { chunkId: 'c1', projectId, documentId: 'd1', text: 'alpha' },
      { chunkId: 'c2', projectId, documentId: 'd1', text: 'beta' },
    ];
    rerank.scores = [0.1, 0.9];
    const built = service({ store, fts, rerank });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'beta',
      k: 5,
      correlationId: 'corr-rerank',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.hits.map((item) => item.chunkId)).toEqual(['c2', 'c1']);
    expect(result.rerankMethod).toBe('llm');
    expect(result.rerankExecutionId).toBe('rerank-exec-1');
    expect(rerank.lastInput?.candidates.map((item) => item.chunkId)).toEqual(['c1', 'c2']);
    expect(built.metrics.snapshot().rerankLlm).toBe(1);
    expect(built.metrics.snapshot().rerankFallbacks).toBe(0);
  });

  it('falls back to BM25 labelled method=deterministic, never as model output', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const rerank = new MemoryRerank();
    rerank.unavailable = true;
    const projectId = generateId();
    store.annHits = [
      { chunkId: 'noise', projectId, documentId: 'd1', text: 'statin lipid' },
      { chunkId: 'hit', projectId, documentId: 'd1', text: 'metformin adults' },
    ];
    const built = service({ store, fts, rerank });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'metformin',
      k: 5,
      correlationId: 'corr-fallback',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.rerankMethod).toBe('deterministic');
    expect(result.rerankMethod).not.toBe('llm');
    expect(result.rerankExecutionId).toBeNull();
    expect(result.hits[0]?.chunkId).toBe('hit');
    expect(built.metrics.snapshot().rerankFallbacks).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/"method":"llm"/);
  });

  it('authz re-check drops cross-project candidates and is not eligibility', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const projectId = generateId();
    const otherProject = generateId();
    store.annHits = [
      { chunkId: 'in-scope', projectId, documentId: 'd1', text: 'metformin' },
      { chunkId: 'leak', projectId: otherProject, documentId: 'd2', text: 'metformin' },
    ];
    const built = service({ store, fts });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'metformin',
      k: 5,
      correlationId: 'corr-authz',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.vectorHits.map((item) => item.chunkId)).toEqual(['in-scope', 'leak']);
    expect(result.hits.map((item) => item.chunkId)).toEqual(['in-scope']);
    expect(result.filteredRecallShortfall).toBe(1);

    const kept = authzRecheck(
      [
        { projectId, chunkId: 'live' },
        { projectId, chunkId: 'deleted-retained' },
        { projectId: otherProject, chunkId: 'other' },
      ],
      projectId,
    );
    expect(kept.map((item) => item.chunkId)).toEqual(['live', 'deleted-retained']);
  });

  it('increments filteredRecallShortfall when more than 30% of candidates are dropped', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const metrics = new RetrievalMetrics(stubLogger());
    const projectId = generateId();
    const otherProject = generateId();
    store.annHits = [
      { chunkId: 'keep-a', projectId, documentId: 'd1', text: 'a' },
      { chunkId: 'keep-b', projectId, documentId: 'd1', text: 'b' },
      { chunkId: 'drop-1', projectId: otherProject, documentId: 'd2', text: 'c' },
      { chunkId: 'drop-2', projectId: otherProject, documentId: 'd2', text: 'd' },
      { chunkId: 'drop-3', projectId: otherProject, documentId: 'd2', text: 'e' },
    ];
    const built = service({ store, fts, metrics });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'a',
      k: 10,
      correlationId: 'corr-shortfall',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.filteredRecallShortfall).toBe(3);
    expect(metrics.snapshot().filteredRecallShortfall).toBe(3);
    expect(metrics.snapshot().filteredRecallDropRate).toBeGreaterThan(FILTERED_RECALL_SHORTFALL_THRESHOLD);
  });

  it('records per-stage RRF and rerank timings separately from ANN and FTS', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const projectId = generateId();
    store.annHits = [{ chunkId: 'c1', projectId, documentId: 'd1', text: 'trial' }];
    const built = service({ store, fts });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'trial',
      k: 1,
      correlationId: 'corr-timing',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.timings.vectorMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.ftsMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.rrfMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.rerankMs).toBeGreaterThanOrEqual(0);
    expect(built.metrics.snapshot().lastRrfMs).not.toBeNull();
    expect(built.metrics.snapshot().lastRerankMs).not.toBeNull();
  });

  it('applies top-k after authz, not as over-fetch', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const projectId = generateId();
    store.annHits = [
      { chunkId: 'c1', projectId, documentId: 'd1', text: 'a' },
      { chunkId: 'c2', projectId, documentId: 'd1', text: 'b' },
      { chunkId: 'c3', projectId, documentId: 'd1', text: 'c' },
    ];
    const built = service({ store, fts });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'a',
      k: 1,
      correlationId: 'corr-topk',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.limit).toBe(3);
    expect(result.hits).toHaveLength(1);
  });

  it('BM25 ranks the matching document first', () => {
    const scores = bm25Scores('metformin', ['statin lipid', 'metformin adults']);
    expect(scores[1]).toBeGreaterThan(scores[0] ?? 0);
  });

  it('QueryRerankAdapter calls Gateway RERANK once on the api role', async () => {
    const execute = jest.fn(async () => {
      return {
        capability: 'RERANK',
        scores: [0.2, 0.8],
        metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 1 },
        inputFingerprint: 'fp',
        promptVersion: 'rerank_v1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        aiExecutionId: generateId(),
        method: 'llm',
      } satisfies GatewayResult;
    });
    const adapter = new QueryRerankAdapter({ execute } as unknown as IGatewayService);
    const result = await adapter.rerank({
      orgId: generateId(),
      projectId: generateId(),
      query: 'metformin',
      candidates: [
        { chunkId: 'c1', text: 'alpha' },
        { chunkId: 'c2', text: 'beta' },
      ],
      correlationId: 'corr-gw',
      runtimeRole: RuntimeRole.Api,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeRole: RuntimeRole.Api }),
      expect.objectContaining({
        capability: 'RERANK',
        query: 'metformin',
        candidates: ['alpha', 'beta'],
      }),
    );
    expect(result.method).toBe('llm');
    expect(result.scores).toEqual([0.2, 0.8]);
  });
});
