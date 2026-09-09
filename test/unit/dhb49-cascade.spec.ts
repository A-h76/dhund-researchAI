import { generateId } from '../../src/platform/ids/uuid-v7';
import { MemoryOrphanSweepStore } from '../fixtures/memory-orphan-sweep-store';

describe('DHB-49 CASCADE policy', () => {
  const documentId = generateId();
  const versionId = generateId();
  const chunkId = generateId();

  let store: MemoryOrphanSweepStore;

  beforeEach(() => {
    store = new MemoryOrphanSweepStore();
    store.seedLive({
      id: documentId,
      projectId: generateId(),
      orgId: generateId(),
      status: 'completed',
      storageKey: 'org/proj/docs/owned.pdf',
    });
    store.seedVersion({
      id: versionId,
      documentId,
      versionNo: 1,
      storageKey: 'org/proj/docs/owned.pdf',
    });
    store.seedChunk({ id: chunkId, documentVersionId: versionId }, generateId());
  });

  it('keeps chunks and embeddings after a document tombstone', async () => {
    store.tombstone(documentId);
    await expect(store.countChunksForDocument(documentId)).resolves.toBe(1);
    await expect(store.countEmbeddingsForDocument(documentId)).resolves.toBe(1);
  });

  it('keeps chunks after version retirement', async () => {
    await expect(store.retireVersion(versionId)).resolves.toBe(true);
    await expect(store.countChunksForDocument(documentId)).resolves.toBe(1);
    await expect(store.countEmbeddingsForDocument(documentId)).resolves.toBe(1);
  });

  it('adds a new version without deleting prior version chunks', async () => {
    await store.addVersion({
      id: generateId(),
      documentId,
      versionNo: 2,
      storageKey: 'org/proj/docs/v2.pdf',
    });
    await expect(store.countChunksForDocument(documentId)).resolves.toBe(1);
    await expect(store.countEmbeddingsForDocument(documentId)).resolves.toBe(1);
  });
});
