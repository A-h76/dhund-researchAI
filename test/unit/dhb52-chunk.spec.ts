import { generateId } from '../../src/platform/ids/uuid-v7';
import { JobEnqueueService } from '../../src/platform/logging';
import type { PlatformLogger } from '../../src/platform/logging';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { OutboxWriterService } from '../../src/platform/events/outbox-writer.service';
import type { OutboxPort } from '../../src/l0/ports';
import { CHUNKER_VERSION } from '../../src/ingestion/extract.constants';
import { EMBED_MODEL_VERSION } from '../../src/ingestion/chunk.constants';
import {
  ChunkService,
  ChunkUnrecoverableError,
} from '../../src/ingestion/chunk.service';
import { ChunkMetrics } from '../../src/ingestion/chunk.metrics';
import { isChunkStale } from '../../src/ingestion/chunk.blocks';
import { MemoryChunkStore } from '../fixtures/memory-chunk-store';
import { MemoryExtractStore } from '../fixtures/memory-extract-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

describe('DHB-52 chunk job', () => {
  const orgId = generateId();
  const projectId = generateId();
  const documentId = generateId();
  const documentVersionId = generateId();
  const contentHash = 'a'.repeat(64);

  let store: MemoryExtractStore;
  let chunkStore: MemoryChunkStore;
  let enqueue: { enqueue: jest.Mock };
  let service: ChunkService;

  function seedVersion(
    versionId: string,
    status: 'processing' | 'partial' | 'completed' | 'cancelled' | 'stale',
    docId = documentId,
  ): void {
    store.seedVersion({
      id: versionId,
      documentId: docId,
      orgId,
      projectId,
      storageKey: `${orgId}/${projectId}/uploads/${versionId}.pdf`,
      documentStatus: status,
      deletedAt: null,
    });
    chunkStore.linkVersion(versionId, docId);
  }

  async function seedBlocks(versionId: string, texts: readonly string[]): Promise<void> {
    await store.insertExtractionWithBlocks({
      extractionId: generateId(),
      documentVersionId: versionId,
      extractorVersion: 'v1',
      contentHash,
      blocks: texts.map((text, ordinal) => ({
        id: generateId(),
        type: 'paragraph',
        page: 1,
        bbox: null,
        text,
        ordinal,
      })),
    });
  }

  function run(versionId = documentVersionId): ReturnType<ChunkService['run']> {
    return runWithCorrelationIdAsync('cor-chunk', () =>
      service.run({
        orgId,
        projectId,
        documentVersionId: versionId,
        chunkerVersion: CHUNKER_VERSION,
        contentHash,
      }),
    );
  }

  beforeEach(() => {
    store = new MemoryExtractStore();
    chunkStore = new MemoryChunkStore(store);
    enqueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    service = new ChunkService(
      store,
      chunkStore,
      new OutboxWriterService(null as unknown as OutboxPort),
      enqueue as unknown as JobEnqueueService,
      new ChunkMetrics(stubLogger()),
    );
  });

  it('produces chunks from blocks, completes the document, and enqueues embed', async () => {
    seedVersion(documentVersionId, 'processing');
    await seedBlocks(documentVersionId, ['First paragraph.', 'Second paragraph.']);

    const outcome = await run();
    expect(outcome).toMatchObject({ kind: 'chunked', partial: false, idempotent: false });

    const chunks = await chunkStore.listChunks(documentVersionId, CHUNKER_VERSION);
    expect(chunks.length).toBeGreaterThan(0);
    expect(store.documentStatus.get(documentId)).toBe('completed');

    // chunks.text is a projection of blocks, hashed over the derived text.
    const blocks = await store.listBlocks(documentVersionId);
    for (const chunk of chunks) {
      expect(isChunkStale(chunk, blocks)).toBe(false);
    }

    expect(chunkStore.eventsOfType('ingestion.document.chunked')).toHaveLength(1);
    expect(chunkStore.eventsOfType('ingestion.document.completed')).toHaveLength(1);
    expect(enqueue.enqueue).toHaveBeenCalledWith(
      'embed',
      expect.objectContaining({
        orgId,
        projectId,
        modelVersion: EMBED_MODEL_VERSION,
        chunkId: chunks[0]!.id,
        contentHash: chunks[0]!.contentHash,
      }),
    );
  });

  it('never emits document.completed for a partial chain', async () => {
    seedVersion(documentVersionId, 'partial');
    await seedBlocks(documentVersionId, ['Low confidence OCR text.']);

    const outcome = await run();
    expect(outcome).toMatchObject({ kind: 'chunked', partial: true });

    expect(store.documentStatus.get(documentId)).toBe('partial');
    expect(chunkStore.eventsOfType('ingestion.document.completed')).toHaveLength(0);
    expect(chunkStore.eventsOfType('ingestion.document.partial')).toHaveLength(1);
    expect(chunkStore.eventsOfType('ingestion.document.chunked')).toHaveLength(1);
  });

  it('is idempotent: a replay adds no chunks and no duplicate events', async () => {
    seedVersion(documentVersionId, 'processing');
    await seedBlocks(documentVersionId, ['Stable text.']);

    await run();
    const afterFirst = (await chunkStore.listChunks(documentVersionId, CHUNKER_VERSION)).length;

    const replay = await run();
    expect(replay).toMatchObject({ kind: 'chunked', idempotent: true, createdCount: 0 });
    expect(await chunkStore.listChunks(documentVersionId, CHUNKER_VERSION)).toHaveLength(
      afterFirst,
    );
    expect(chunkStore.eventsOfType('ingestion.document.completed')).toHaveLength(1);
    expect(chunkStore.eventsOfType('ingestion.document.chunked')).toHaveLength(1);
    expect(store.documentStatus.get(documentId)).toBe('completed');
  });

  it('skips re-embedding unchanged content on a new version (content-addressed reuse)', async () => {
    const v2 = generateId();
    seedVersion(documentVersionId, 'processing');
    await seedBlocks(documentVersionId, ['Same content.', 'Unchanged paragraph.']);
    await run();
    const embedCallsAfterV1 = enqueue.enqueue.mock.calls.length;
    expect(embedCallsAfterV1).toBeGreaterThan(0);

    // DOI re-ingest: v2 of the SAME document with identical content.
    await store.markDocumentStatus(documentId, 'stale');
    await store.markDocumentStatus(documentId, 'processing');
    seedVersion(v2, 'processing');
    await seedBlocks(v2, ['Same content.', 'Unchanged paragraph.']);

    const outcome = await run(v2);
    expect(outcome.kind).toBe('chunked');
    if (outcome.kind === 'chunked') {
      expect(outcome.reusedCount).toBe(outcome.chunkCount);
    }

    // v2 gets its own chunk rows, but no embed jobs for unchanged hashes.
    expect((await chunkStore.listChunks(v2, CHUNKER_VERSION)).length).toBeGreaterThan(0);
    expect(enqueue.enqueue.mock.calls.length).toBe(embedCallsAfterV1);
    expect(store.documentStatus.get(documentId)).toBe('completed');
  });

  it('re-embeds changed content on a new version', async () => {
    const v2 = generateId();
    seedVersion(documentVersionId, 'processing');
    await seedBlocks(documentVersionId, ['Original content.']);
    await run();
    const embedCallsAfterV1 = enqueue.enqueue.mock.calls.length;

    await store.markDocumentStatus(documentId, 'stale');
    await store.markDocumentStatus(documentId, 'processing');
    seedVersion(v2, 'processing');
    await seedBlocks(v2, ['Revised content that differs.']);

    await run(v2);
    expect(enqueue.enqueue.mock.calls.length).toBeGreaterThan(embedCallsAfterV1);
  });

  it('keeps v1 chunks resolvable after v2 exists (evidence stays bound to its version)', async () => {
    const v2 = generateId();
    seedVersion(documentVersionId, 'processing');
    await seedBlocks(documentVersionId, ['Version one text cited as evidence.']);
    await run();
    const v1Chunks = await chunkStore.listChunks(documentVersionId, CHUNKER_VERSION);
    const v1Blocks = await store.listBlocks(documentVersionId);

    await store.markDocumentStatus(documentId, 'stale');
    await store.markDocumentStatus(documentId, 'processing');
    seedVersion(v2, 'processing');
    await seedBlocks(v2, ['Version two replaces the wording entirely.']);
    await run(v2);

    // v1 chunks and blocks are untouched and still reconstruct.
    const v1After = await chunkStore.listChunks(documentVersionId, CHUNKER_VERSION);
    expect(v1After).toEqual(v1Chunks);
    for (const chunk of v1After) {
      expect(isChunkStale(chunk, v1Blocks)).toBe(false);
      expect(chunk.documentVersionId).toBe(documentVersionId);
    }
  });

  it('detects stale stored chunks without mutating them (blocks are authoritative)', async () => {
    seedVersion(documentVersionId, 'processing');
    await seedBlocks(documentVersionId, ['Original block text.']);
    await run();
    const originalChunkText = chunkStore.chunks[0]!.text;

    // Blocks change after the chunk was written (e.g. extraction re-run):
    // blocks are authoritative, so the stored chunk is now stale.
    (store.blocks[0] as { text: string }).text = 'Rewritten block text.';
    const blocks = await store.listBlocks(documentVersionId);
    expect(isChunkStale(chunkStore.chunks[0]!, blocks)).toBe(true);

    await store.markDocumentStatus(documentId, 'stale');
    await store.markDocumentStatus(documentId, 'processing');
    const outcome = await run();

    // The stale row was NOT edited in place; a recomputed content-addressed
    // chunk was inserted alongside instead.
    expect(chunkStore.chunks[0]!.text).toBe(originalChunkText);
    expect(outcome).toMatchObject({ kind: 'chunked', idempotent: false });
    expect(chunkStore.chunks.length).toBeGreaterThan(1);
  });

  it('fails unrecoverably when there are no blocks and when the version is missing', async () => {
    seedVersion(documentVersionId, 'processing');
    await expect(run()).rejects.toThrow(ChunkUnrecoverableError);

    await expect(run(generateId())).rejects.toThrow(ChunkUnrecoverableError);
  });

  it('rejects a forbidden completion transition instead of forcing it', async () => {
    seedVersion(documentVersionId, 'cancelled');
    await seedBlocks(documentVersionId, ['Text.']);

    await expect(run()).rejects.toThrow(ChunkUnrecoverableError);
    expect(store.documentStatus.get(documentId)).toBe('cancelled');
  });

  it('marks failed with a document.failed outbox event, and never un-completes', async () => {
    seedVersion(documentVersionId, 'processing');
    await runWithCorrelationIdAsync('cor-chunk', () =>
      service.failDocument(documentVersionId),
    );
    expect(store.documentStatus.get(documentId)).toBe('failed');
    expect(chunkStore.eventsOfType('ingestion.document.failed')).toHaveLength(1);

    // failDocument on a completed document is a guarded no-op.
    const doneVersion = generateId();
    const doneDoc = generateId();
    seedVersion(doneVersion, 'completed', doneDoc);
    await runWithCorrelationIdAsync('cor-chunk', () =>
      service.failDocument(doneVersion),
    );
    expect(store.documentStatus.get(doneDoc)).toBe('completed');
  });
});
