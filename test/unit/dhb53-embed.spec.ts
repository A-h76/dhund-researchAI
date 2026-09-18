import {
  EMBED_DIMENSION,
  EMBED_MODEL_ID,
  EMBED_MODEL_VERSION,
  WRITE_ACTIVE_EMBED_MODEL_VERSION,
  isWriteActiveEmbedModelVersion,
} from '../../src/ai/policy/embed-policy.constants';
import type { IGatewayService } from '../../src/ai/gateway/gateway.port';
import { GatewayExecutionFailedError } from '../../src/ai/gateway/gateway-execution.errors';
import { EMBED_MODEL_VERSION as CHUNK_EMBED_MODEL_VERSION } from '../../src/ingestion/chunk.constants';
import { EmbedMetrics } from '../../src/ai/embed/embed.metrics';
import { EmbedService, EmbedUnrecoverableError } from '../../src/ai/embed/embed.service';
import { EMBEDDING_VECTOR_DIMENSION } from '../../src/l0/ports/embedding-store.port';
import { DomainError, ErrorCode } from '../../src/platform/errors';
import { assertDocumentReady } from '../../src/ingestion/document-readiness';
import type { PlatformLogger } from '../../src/platform/logging';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { MemoryEmbeddingStore } from '../fixtures/memory-embedding-store';
import { MemoryExtractStore } from '../fixtures/memory-extract-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

function vector(dimensions: number = EMBED_DIMENSION, value = 0.01): number[] {
  return Array.from({ length: dimensions }, () => value);
}

describe('DHB-53 embed job', () => {
  const orgId = generateId();
  const projectId = generateId();
  const documentId = generateId();
  const documentVersionId = generateId();
  const chunkId = generateId();
  const contentHash = 'a'.repeat(64);

  let store: MemoryEmbeddingStore;
  let extractStore: MemoryExtractStore;
  let gateway: { execute: jest.Mock };
  let metrics: EmbedMetrics;
  let service: EmbedService;

  function seedChunk(id = chunkId, hash = contentHash, text = 'Chunk text.'): void {
    store.seedChunk({
      chunkId: id,
      orgId,
      projectId,
      documentId,
      documentVersionId,
      contentHash: hash,
      text,
    });
  }

  function seedDocument(status: 'processing' | 'completed'): void {
    extractStore.seedVersion({
      id: documentVersionId,
      documentId,
      orgId,
      projectId,
      storageKey: `${orgId}/${projectId}/docs/paper.pdf`,
      documentStatus: status,
      deletedAt: null,
    });
  }

  function embedResult(count: number, dimensions: number = EMBED_DIMENSION) {
    return {
      capability: 'EMBED' as const,
      vectors: Array.from({ length: count }, () => vector(dimensions)),
      inputType: 'document' as const,
      metrics: { latencyMs: 5, tokensIn: 12, tokensOut: 0, costMicros: 120 },
      inputFingerprint: 'fp',
      promptVersion: EMBED_MODEL_VERSION,
      provider: 'voyage',
      model: EMBED_MODEL_ID,
      aiExecutionId: generateId(),
      method: 'llm' as const,
    };
  }

  function run(modelVersion = WRITE_ACTIVE_EMBED_MODEL_VERSION, hash = contentHash) {
    return runWithCorrelationIdAsync('cor-embed', () =>
      service.run({ orgId, projectId, chunkId, modelVersion, contentHash: hash }),
    );
  }

  beforeEach(() => {
    store = new MemoryEmbeddingStore();
    extractStore = new MemoryExtractStore();
    gateway = { execute: jest.fn().mockResolvedValue(embedResult(1)) };
    metrics = new EmbedMetrics(stubLogger());
    service = new EmbedService(
      store,
      extractStore,
      gateway as unknown as IGatewayService,
      metrics,
    );
  });

  it('GAP-EMBED-01: writes one 1024-dim row with the locked model id and version', async () => {
    seedChunk();

    const outcome = await run();

    expect(outcome).toEqual({ kind: 'embedded', written: 1, idempotent: false });
    expect(store.embeddings).toHaveLength(1);
    expect(store.embeddings[0]).toMatchObject({
      chunkId,
      projectId,
      contentHash,
      modelId: EMBED_MODEL_ID,
      modelVersion: EMBED_MODEL_VERSION,
      dimensions: EMBEDDING_VECTOR_DIMENSION,
      status: 'ok',
    });
  });

  it('GAP-EMBED-01: embeds stored chunks as documents through Gateway EMBED as a worker', async () => {
    seedChunk();

    await run();

    expect(gateway.execute).toHaveBeenCalledTimes(1);
    const [ctx, request] = gateway.execute.mock.calls[0]!;
    expect(ctx).toMatchObject({
      orgId,
      projectId,
      correlationId: 'cor-embed',
      runtimeRole: RuntimeRole.Worker,
    });
    expect(request).toEqual({
      capability: 'EMBED',
      texts: ['Chunk text.'],
      inputType: 'document',
      expectedDimensions: [EMBED_DIMENSION],
    });
  });

  it('GAP-EMBED-01: rejects a non-1024 vector at write instead of truncating it', async () => {
    seedChunk();
    gateway.execute.mockResolvedValue(embedResult(1, 512));

    await expect(run()).rejects.toThrow(EmbedUnrecoverableError);
    expect(store.embeddings).toHaveLength(0);
    expect(metrics.snapshot().failures.dimension_mismatch).toBe(1);
  });

  it('rejects an embed targeting a non-active model version', async () => {
    seedChunk();

    await expect(run('embedding_v2')).rejects.toMatchObject({
      causeCode: 'inactive_model_version',
    });
    expect(gateway.execute).not.toHaveBeenCalled();
    expect(store.embeddings).toHaveLength(0);
  });

  it('is idempotent on (chunk, model version, content hash): a re-run inserts nothing', async () => {
    seedChunk();
    await run();

    const replay = await run();

    expect(replay).toEqual({ kind: 'embedded', written: 0, idempotent: true });
    expect(store.embeddings).toHaveLength(1);
    expect(gateway.execute).toHaveBeenCalledTimes(1);
  });

  it('lets two model versions coexist for the same chunk', async () => {
    seedChunk();
    await run();

    // Only backfill may target a non-active version, so it enters through the
    // shared engine rather than through run().
    const chunk = (await store.findChunk(chunkId))!;
    await runWithCorrelationIdAsync('cor-embed', () =>
      service.embedChunks({ orgId, chunks: [chunk], modelVersion: 'embedding_v2' }),
    );

    expect(store.embeddings).toHaveLength(2);
    expect(store.embeddings.map((row) => row.modelVersion).sort()).toEqual([
      'embedding_v1',
      'embedding_v2',
    ]);
  });

  it('skips a job whose content hash no longer matches the stored chunk', async () => {
    seedChunk();

    await expect(run(WRITE_ACTIVE_EMBED_MODEL_VERSION, 'b'.repeat(64))).resolves.toEqual({
      kind: 'skipped',
    });
    expect(gateway.execute).not.toHaveBeenCalled();
  });

  it('fails unrecoverably when the chunk is gone', async () => {
    await expect(run()).rejects.toMatchObject({ causeCode: 'chunk_missing' });
  });

  it('marks the document partial when embedding fails, so consumers refuse it', async () => {
    seedChunk();
    seedDocument('completed');

    await service.markDocumentPartial(chunkId);

    expect(extractStore.documentStatus.get(documentId)).toBe('partial');
    expect(metrics.snapshot().documentsDegraded).toBe(1);
    expect(() => assertDocumentReady('partial')).toThrow(DomainError);
    try {
      assertDocumentReady('partial');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.DocumentNotReady });
    }
  });

  it('counts a surviving 429 separately from other gateway failures', async () => {
    seedChunk();
    gateway.execute.mockRejectedValue(
      new GatewayExecutionFailedError(generateId(), ['voyage 429 rate limited']),
    );

    await expect(run()).rejects.toThrow(GatewayExecutionFailedError);
    expect(metrics.snapshot().failures.rate_limited).toBe(1);
    expect(metrics.snapshot().failures.gateway).toBe(0);
  });

  it('keeps the chunk-side and policy-side model versions on one value', () => {
    expect(CHUNK_EMBED_MODEL_VERSION).toBe(EMBED_MODEL_VERSION);
    expect(isWriteActiveEmbedModelVersion(CHUNK_EMBED_MODEL_VERSION)).toBe(true);
    expect(EMBED_DIMENSION).toBe(EMBEDDING_VECTOR_DIMENSION);
  });
});
