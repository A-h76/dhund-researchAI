import {
  EMBEDDING_VECTOR_DIMENSION,
  EmbeddingDimensionMismatchError,
} from '../../src/l0/ports/embedding-store.port';
import { L0OperationError } from '../../src/l0/ports/errors';
import {
  HNSW_EF_SEARCH_DEFAULT,
  HNSW_EF_SEARCH_MAX,
  HNSW_EF_SEARCH_MIN,
} from '../../src/l0/ports/hnsw.constants';
import {
  InvalidHnswEfSearchError,
  assertQueryVectorDimension,
  countVectorDimensions,
  resolveHnswEfSearch,
} from '../../src/l0/ports/hnsw-ef-search';
import { RetrievalArmUnavailableError } from '../../src/l0/ports/retrieval-index.port';
import type { PlatformLogger } from '../../src/platform/logging';
import { AnnSearch } from '../../src/retrieval/ann-search';
import {
  FILTERED_RECALL_SHORTFALL_THRESHOLD,
  filteredRecallDropRate,
  filteredRecallShortfall,
} from '../../src/retrieval/filtered-recall';
import { RetrievalMetrics } from '../../src/retrieval/retrieval.metrics';
import { buildTestAppConfig } from '../fixtures/app-config.fixture';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

function vectorLiteral(dimensions: number, value = 0.01): string {
  return `[${Array.from({ length: dimensions }, () => value).join(',')}]`;
}

describe('DHB-54 GAP-HNSW-01 runtime', () => {
  it('resolves the default ef_search of 80 and rejects out-of-range values', () => {
    expect(resolveHnswEfSearch()).toBe(HNSW_EF_SEARCH_DEFAULT);
    expect(resolveHnswEfSearch(HNSW_EF_SEARCH_MIN)).toBe(1);
    expect(resolveHnswEfSearch(HNSW_EF_SEARCH_MAX)).toBe(400);
    expect(() => resolveHnswEfSearch(0)).toThrow(InvalidHnswEfSearchError);
    expect(() => resolveHnswEfSearch(401)).toThrow(InvalidHnswEfSearchError);
    expect(() => resolveHnswEfSearch(80.5)).toThrow(InvalidHnswEfSearchError);
  });

  it('rejects a cross-dimension query vector without truncating', () => {
    expect(countVectorDimensions(vectorLiteral(EMBEDDING_VECTOR_DIMENSION))).toBe(1024);
    expect(() => assertQueryVectorDimension(vectorLiteral(512))).toThrow(
      EmbeddingDimensionMismatchError,
    );
    expect(() => assertQueryVectorDimension(vectorLiteral(2048))).toThrow(
      EmbeddingDimensionMismatchError,
    );
    expect(() => assertQueryVectorDimension(vectorLiteral(1024))).not.toThrow();
  });

  it('passes runtime ef_search through AnnSearch without a migration', async () => {
    const store = new MemoryScopedStore();
    store.annHits = [{ chunkId: 'c1', projectId: 'p1' }];
    const metrics = new RetrievalMetrics(stubLogger());
    const search = new AnnSearch(store, buildTestAppConfig({ hnswEfSearch: 80 }), metrics);

    const defaulted = await search.nearest({ projectId: 'p1' }, vectorLiteral(1024), 5);
    expect(defaulted.efSearch).toBe(80);
    expect(store.lastEfSearch).toBe(80);

    const tuned = await search.nearest({ projectId: 'p1' }, vectorLiteral(1024), 5, 40);
    expect(tuned.efSearch).toBe(40);
    expect(store.lastEfSearch).toBe(40);
    expect(metrics.snapshot().lastEfSearch).toBe(40);
    expect(metrics.snapshot().vectorQueries).toBe(2);
  });

  it('surfaces vector-arm unavailability explicitly', async () => {
    const store = new MemoryScopedStore();
    store.annNearest = () => Promise.reject(new L0OperationError('index missing'));
    const metrics = new RetrievalMetrics(stubLogger());
    const search = new AnnSearch(store, buildTestAppConfig(), metrics);

    await expect(search.nearest({ projectId: 'p1' }, vectorLiteral(1024), 5)).rejects.toBeInstanceOf(
      RetrievalArmUnavailableError,
    );
    expect(metrics.snapshot().vectorUnavailable).toBe(1);
  });

  it('uses the canonical filteredRecallShortfall definition before top-k', () => {
    expect(filteredRecallShortfall(10, 7)).toBe(3);
    expect(filteredRecallDropRate(10, 7)).toBe(0.3);
    expect(filteredRecallDropRate(10, 6)).toBeGreaterThan(FILTERED_RECALL_SHORTFALL_THRESHOLD);
    expect(filteredRecallShortfall(0, 0)).toBe(0);

    const metrics = new RetrievalMetrics(stubLogger());
    expect(metrics.recordFilteredRecall(10, 6)).toBe(4);
    expect(metrics.snapshot().filteredRecallShortfall).toBe(4);
    expect(metrics.snapshot().filteredRecallDropRate).toBe(0.4);
  });
});
