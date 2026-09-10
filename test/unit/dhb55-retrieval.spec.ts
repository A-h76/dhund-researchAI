import { QueryEmbedAdapter } from '../../src/ai/embed/query-embed.adapter';
import type { IGatewayService } from '../../src/ai/gateway/gateway.port';
import type { GatewayResult } from '../../src/ai/gateway/gateway.types';
import { EmbeddingDimensionMismatchError } from '../../src/l0/ports';
import { RETRIEVAL_ELIGIBILITY_SQL } from '../../src/l0/ports/retrieval-eligibility';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { RETRIEVAL_OVER_FETCH_FACTOR, armLimit } from '../../src/retrieval/over-fetch';
import { EmptyRetrievalQueryError, understandQuery } from '../../src/retrieval/query-understanding';
import { RetrievalMetrics } from '../../src/retrieval/retrieval.metrics';
import { MemoryQueryEmbed } from '../fixtures/memory-query-embed';
import { MemoryRerank } from '../fixtures/memory-rerank';
import { MemoryRetrievalIndexStore } from '../fixtures/memory-retrieval-index';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';
import { buildRetrievalService, stubLogger } from '../fixtures/memory-retrieval-service';

function vector(dimensions: number, value = 0.02): number[] {
  return Array.from({ length: dimensions }, () => value);
}

describe('DHB-55 RetrievalService arms', () => {
  it('applies over-fetch f to each arm LIMIT', async () => {
    expect(RETRIEVAL_OVER_FETCH_FACTOR).toBe(3);
    expect(armLimit(5)).toBe(15);

    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const embed = new MemoryQueryEmbed();
    const metrics = new RetrievalMetrics(stubLogger());
    const projectId = generateId();
    const documentId = generateId();
    const chunkId = generateId();
    store.annHits = [{ chunkId, projectId, documentId }];
    fts.chunks = [
      {
        chunkId,
        projectId,
        documentId,
        text: 'randomized trial',
      },
    ];
    const built = buildRetrievalService({
      store,
      fts,
      embed,
      metrics,
      rerank: new MemoryRerank(),
    });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: '  randomized   trial ',
      k: 5,
      correlationId: 'corr-1',
      runtimeRole: RuntimeRole.Api,
    });

    expect(result.understoodQuery).toBe('randomized trial');
    expect(result.limit).toBe(15);
    expect(store.lastLimit).toBe(15);
    expect(fts.lastLimit).toBe(15);
    expect(result.vectorHits).toEqual([
      {
        chunkId,
        projectId,
        documentId,
        text: '',
        arm: 'vector',
        vectorScore: null,
        ftsScore: null,
      },
    ]);
    expect(result.ftsHits).toEqual([
      {
        chunkId,
        projectId,
        documentId,
        text: 'randomized trial',
        arm: 'fts',
        vectorScore: null,
        ftsScore: 1,
      },
    ]);
    expect(result.timings.vectorMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.ftsMs).toBeGreaterThanOrEqual(0);
    expect(embed.lastInput?.text).toBe('randomized trial');
    expect(metrics.snapshot().lastVectorMs).not.toBeNull();
    expect(metrics.snapshot().lastFtsMs).not.toBeNull();
  });

  it('fusion input is exactly the arm hits — no post-SQL eligibility filter', async () => {
    const store = new MemoryScopedStore();
    const fts = new MemoryRetrievalIndexStore();
    const metrics = new RetrievalMetrics(stubLogger());
    const projectId = generateId();
    store.annHits = [
      { chunkId: 'v1', projectId, documentId: 'd1' },
      { chunkId: 'v2', projectId, documentId: 'd1' },
    ];
    fts.chunks = [{ chunkId: 'f1', projectId, documentId: 'd1', text: 'metformin adults' }];
    const built = buildRetrievalService({ store, fts, metrics, rerank: new MemoryRerank() });

    const result = await built.service.retrieve({
      orgId: generateId(),
      projectId,
      query: 'metformin adults',
      k: 1,
      correlationId: 'corr-2',
      runtimeRole: RuntimeRole.Worker,
    });

    expect(result.limit).toBe(3);
    expect(result.vectorHits.map((hit) => hit.chunkId)).toEqual(['v1', 'v2']);
    expect(result.ftsHits.map((hit) => hit.chunkId)).toEqual(['f1']);
    expect(RETRIEVAL_ELIGIBILITY_SQL).toContain('d.deleted_at IS NULL');
  });

  it('rejects an empty query during query understanding', () => {
    expect(() => understandQuery('   ')).toThrow(EmptyRetrievalQueryError);
  });

  it('GAP-EMBED-01: QueryEmbedAdapter calls Gateway EMBED with input_type=query', async () => {
    const execute = jest.fn(async () => {
      return {
        capability: 'EMBED',
        vectors: [vector(1024)],
        inputType: 'query',
        metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 0, costMicros: 1 },
        inputFingerprint: 'fp',
        promptVersion: 'embedding_v1',
        provider: 'voyage',
        model: 'voyage-4',
        aiExecutionId: generateId(),
        method: 'llm',
      } satisfies GatewayResult;
    });
    const adapter = new QueryEmbedAdapter({ execute } as unknown as IGatewayService);
    const literal = await adapter.embedQuery({
      orgId: generateId(),
      projectId: generateId(),
      text: 'metformin',
      correlationId: 'corr-q',
      runtimeRole: RuntimeRole.Api,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeRole: RuntimeRole.Api }),
      expect.objectContaining({
        capability: 'EMBED',
        texts: ['metformin'],
        inputType: 'query',
        expectedDimensions: [1024],
      }),
    );
    expect(literal.startsWith('[')).toBe(true);
    expect(literal.split(',').length).toBe(1024);
  });

  it('rejects a non-1024 query vector from the gateway', async () => {
    const adapter = new QueryEmbedAdapter({
      execute: async () =>
        ({
          capability: 'EMBED',
          vectors: [vector(512)],
          inputType: 'query',
          metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 0, costMicros: 1 },
          inputFingerprint: 'fp',
          promptVersion: 'embedding_v1',
          provider: 'voyage',
          model: 'voyage-4',
          aiExecutionId: generateId(),
          method: 'llm',
        }) satisfies GatewayResult,
    } as unknown as IGatewayService);

    await expect(
      adapter.embedQuery({
        orgId: generateId(),
        projectId: generateId(),
        text: 'metformin',
        correlationId: 'corr-q',
        runtimeRole: RuntimeRole.Api,
      }),
    ).rejects.toBeInstanceOf(EmbeddingDimensionMismatchError);
  });
});
