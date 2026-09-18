import { EvidenceMetrics } from '../../src/evidence/evidence.metrics';
import { EvidenceRepository } from '../../src/evidence/evidence.repository';
import { SourcesRepository } from '../../src/evidence/sources.repository';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import type { PlatformLogger } from '../../src/platform/logging';
import { ScopedMetrics } from '../../src/platform/persistence/scoped.metrics';
import { ScopedReader } from '../../src/platform/persistence/scoped-reader';
import { MemoryChunkStore } from '../fixtures/memory-chunk-store';
import { MemoryExtractStore } from '../fixtures/memory-extract-store';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

describe('DHB-58 sources and evidence locator invariants', () => {
  const projectId = generateId();
  const otherProjectId = generateId();
  const scope = { projectId };
  const otherScope = { projectId: otherProjectId };
  const orgId = generateId();
  const documentId = generateId();
  const versionId = generateId();
  const blockId = generateId();
  const chunkId = generateId();
  const blockText = 'The trial enrolled 240 patients with glioma.';

  let store: MemoryScopedStore;
  let extract: MemoryExtractStore;
  let chunks: MemoryChunkStore;
  let metrics: EvidenceMetrics;
  let sources: SourcesRepository;
  let evidence: EvidenceRepository;

  beforeEach(async () => {
    store = new MemoryScopedStore();
    extract = new MemoryExtractStore();
    chunks = new MemoryChunkStore(extract);
    metrics = new EvidenceMetrics(stubLogger());
    const reader = new ScopedReader(store, new ScopedMetrics(stubLogger()));
    sources = new SourcesRepository(reader, store);
    evidence = new EvidenceRepository(reader, store, chunks, extract, metrics);

    await store.insert('document', scope, {
      id: documentId,
      title: 'Paper',
      status: 'completed',
    });
    extract.seedVersion({
      id: versionId,
      documentId,
      orgId,
      projectId,
      storageKey: 'doc/v1',
      documentStatus: 'completed',
      deletedAt: null,
    });
    await extract.insertExtractionWithBlocks({
      extractionId: generateId(),
      documentVersionId: versionId,
      extractorVersion: 'v1',
      contentHash: 'a'.repeat(64),
      blocks: [
        {
          id: blockId,
          type: 'paragraph',
          page: 1,
          bbox: null,
          text: blockText,
          ordinal: 0,
        },
      ],
    });
    chunks.linkVersion(versionId, documentId);
    chunks.chunks.push({
      id: chunkId,
      documentVersionId: versionId,
      projectId,
      ordinal: 0,
      charSpan: { start: 0, end: blockText.length },
      tokenCount: 8,
      page: 1,
      section: null,
      blockIds: [blockId],
      contentHash: 'hash-v1',
      chunkerVersion: 'v1',
      text: blockText,
    });
  });

  async function documentSource(): Promise<string> {
    const row = await sources.create(scope, { type: 'document', documentId });
    return row.id;
  }

  function bodyLocator(overrides: Record<string, unknown> = {}) {
    return {
      blockId,
      documentVersionId: versionId,
      page: 1,
      ...overrides,
    };
  }

  describe('sources exclusivity', () => {
    it('rejects sources with zero or two targets', async () => {
      await expect(
        sources.create(scope, { type: 'document' }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
      const extra = generateId();
      await store.insert('external_record', scope, { id: extra, title: 'ext' });
      await expect(
        sources.create(scope, {
          type: 'document',
          documentId,
          externalRecordId: extra,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
    });

    it('creates a document source with exactly one target', async () => {
      const row = await sources.create(scope, { type: 'document', documentId });
      expect(row.documentId).toBe(documentId);
      expect(row.externalRecordId).toBeUndefined();
    });
  });

  describe('§2.5 / §11.2 write invariants', () => {
    it('rejects body_grounded evidence without chunkId', async () => {
      const sourceId = await documentSource();
      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'body_grounded',
          extractionMethod: 'deterministic',
          text: 'The trial enrolled 240 patients',
          locator: bodyLocator(),
          qualityScore: 0.9,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
      expect(metrics.snapshot().locatorRejections).toBeGreaterThan(0);
      expect(await store.list('evidence', scope, { limit: 50 })).toEqual([]);
    });

    it('requires LLM evidence to carry aiExecutionId', async () => {
      const sourceId = await documentSource();
      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'body_grounded',
          extractionMethod: 'llm',
          text: 'The trial enrolled 240 patients',
          locator: bodyLocator(),
          chunkId,
          qualityScore: 0.9,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
      expect(await store.list('evidence', scope, { limit: 50 })).toEqual([]);
    });

    it('writes body_grounded evidence with locator, chunkId, and deterministic method', async () => {
      const sourceId = await documentSource();
      const row = await evidence.create(scope, {
        sourceId,
        type: 'body_grounded',
        extractionMethod: 'deterministic',
        text: 'The trial enrolled 240 patients',
        locator: bodyLocator(),
        chunkId,
        qualityScore: 0.9,
      });
      expect(row.chunkId).toBe(chunkId);
      expect(row.locator).toEqual(bodyLocator());
      expect(row.extractionMethod).toBe('deterministic');
      expect(row.aiExecutionId).toBeUndefined();
      expect(metrics.snapshot().createdByType.body_grounded).toBe(1);
      expect(metrics.snapshot().createdByMethod.deterministic).toBe(1);
    });

    it('writes LLM evidence with aiExecutionId', async () => {
      const sourceId = await documentSource();
      const aiExecutionId = generateId();
      const row = await evidence.create(scope, {
        sourceId,
        type: 'body_grounded',
        extractionMethod: 'llm',
        text: 'The trial enrolled 240 patients',
        locator: bodyLocator(),
        chunkId,
        aiExecutionId,
        qualityScore: 0.8,
      });
      expect(row.aiExecutionId).toBe(aiExecutionId);
      expect(metrics.snapshot().createdByMethod.llm).toBe(1);
    });

    it('rejects evidence without a locator and writes no row', async () => {
      const sourceId = await documentSource();
      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'body_grounded',
          extractionMethod: 'deterministic',
          text: 'The trial enrolled 240 patients',
          locator: {},
          chunkId,
          qualityScore: 0.9,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
      expect(await store.list('evidence', scope, { limit: 50 })).toEqual([]);
    });

    it('produces no evidence row when a model omits a locator', async () => {
      const sourceId = await documentSource();
      const admitted = await evidence.admitModel(scope, {
        sourceId,
        type: 'body_grounded',
        extractionMethod: 'llm',
        aiExecutionId: generateId(),
        text: 'The trial enrolled 240 patients',
        locator: undefined,
        chunkId,
        qualityScore: 0.9,
      });
      expect(admitted).toBeNull();
      expect(await store.list('evidence', scope, { limit: 50 })).toEqual([]);
      expect(metrics.snapshot().locatorRejections).toBe(1);
      expect(metrics.snapshot().created).toBe(0);
    });

    it('resolves locator.blockId to the same version and matching page', async () => {
      const sourceId = await documentSource();
      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'body_grounded',
          extractionMethod: 'deterministic',
          text: 'The trial enrolled 240 patients',
          locator: bodyLocator({ page: 9 }),
          chunkId,
          qualityScore: 0.9,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });

      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'body_grounded',
          extractionMethod: 'deterministic',
          text: 'The trial enrolled 240 patients',
          locator: bodyLocator({ blockId: generateId() }),
          chunkId,
          qualityScore: 0.9,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
    });

    it('rejects quoted text that does not correspond to the chunk', async () => {
      const sourceId = await documentSource();
      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'body_grounded',
          extractionMethod: 'deterministic',
          text: 'Patients were given a placebo only',
          locator: bodyLocator(),
          chunkId,
          qualityScore: 0.9,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
    });

    it('supersession creates a new row and leaves the original content unchanged', async () => {
      const sourceId = await documentSource();
      const original = await evidence.create(scope, {
        sourceId,
        type: 'body_grounded',
        extractionMethod: 'deterministic',
        text: 'The trial enrolled 240 patients',
        locator: bodyLocator(),
        chunkId,
        qualityScore: 0.4,
      });
      const { previous, current } = await evidence.supersede(scope, original.id, {
        sourceId,
        type: 'body_grounded',
        extractionMethod: 'deterministic',
        text: 'The trial enrolled 240 patients with glioma',
        locator: bodyLocator(),
        chunkId,
        qualityScore: 0.95,
      });
      expect(current.id).not.toBe(original.id);
      expect(previous.id).toBe(original.id);
      expect(previous.text).toBe(original.text);
      expect(previous.locator).toEqual(original.locator);
      expect(previous.chunkId).toBe(original.chunkId);
      expect(previous.type).toBe(original.type);
      expect(previous.extractionMethod).toBe(original.extractionMethod);
      expect(previous.qualityScore).toBe(original.qualityScore);
      expect(previous.supersededById).toBe(current.id);
      expect(current.supersededById).toBeUndefined();
      expect(current.text).toBe('The trial enrolled 240 patients with glioma');
    });
  });

  describe('§11.3 isolation and PX-b', () => {
    it('rejects a cross-project chunkId with leakage target 0', async () => {
      const foreignChunkId = generateId();
      const foreignVersion = generateId();
      const foreignDocument = generateId();
      chunks.linkVersion(foreignVersion, foreignDocument);
      chunks.chunks.push({
        id: foreignChunkId,
        documentVersionId: foreignVersion,
        projectId: otherProjectId,
        ordinal: 0,
        charSpan: { start: 0, end: 12 },
        tokenCount: 2,
        page: 1,
        section: null,
        blockIds: [generateId()],
        contentHash: 'other',
        chunkerVersion: 'v1',
        text: 'secret other project body',
      });
      const sourceId = await documentSource();
      const beforeLookups = chunks.chunkLookups;
      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'body_grounded',
          extractionMethod: 'deterministic',
          text: 'secret other project body',
          locator: bodyLocator(),
          chunkId: foreignChunkId,
          qualityScore: 0.9,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
      expect(chunks.chunkLookups).toBe(beforeLookups + 1);
      expect(await store.list('evidence', scope, { limit: 50 })).toEqual([]);
      expect(await store.list('evidence', otherScope, { limit: 50 })).toEqual([]);
    });

    it('does not let metadata-only masquerade as body-grounded when body is forbidden', async () => {
      extract.seedBodyCapability(documentId, 'forbidden');
      const sourceId = await documentSource();
      extract.blockLookups = 0;
      chunks.chunkLookups = 0;
      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'body_grounded',
          extractionMethod: 'deterministic',
          text: 'The trial enrolled 240 patients',
          locator: bodyLocator(),
          chunkId,
          qualityScore: 0.9,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
      expect(extract.blockLookups).toBe(0);
      expect(chunks.chunkLookups).toBe(0);

      await expect(
        evidence.create(scope, {
          sourceId,
          type: 'metadata_only',
          extractionMethod: 'deterministic',
          text: 'Title-level metadata',
          locator: { field: 'title' },
          chunkId,
          qualityScore: 0.2,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
      expect(extract.blockLookups).toBe(0);
      expect(chunks.chunkLookups).toBe(0);

      const row = await evidence.create(scope, {
        sourceId,
        type: 'metadata_only',
        extractionMethod: 'deterministic',
        text: 'Title-level metadata',
        locator: { field: 'title' },
        qualityScore: 0.2,
      });
      expect(row.type).toBe('metadata_only');
      expect(row.chunkId).toBeUndefined();
      expect(extract.blockLookups).toBe(0);
      expect(chunks.chunkLookups).toBe(0);
    });

    it('keeps evidence from version n resolving to n after n+1 exists', async () => {
      const sourceId = await documentSource();
      const row = await evidence.create(scope, {
        sourceId,
        type: 'body_grounded',
        extractionMethod: 'deterministic',
        text: 'The trial enrolled 240 patients',
        locator: bodyLocator(),
        chunkId,
        qualityScore: 0.9,
      });
      const versionTwo = generateId();
      extract.seedVersion({
        id: versionTwo,
        documentId,
        orgId,
        projectId,
        storageKey: 'doc/v2',
        documentStatus: 'completed',
        deletedAt: null,
      });
      await extract.insertExtractionWithBlocks({
        extractionId: generateId(),
        documentVersionId: versionTwo,
        extractorVersion: 'v1',
        contentHash: 'b'.repeat(64),
        blocks: [
          {
            id: generateId(),
            type: 'paragraph',
            page: 1,
            bbox: null,
            text: 'A later revision of the paper.',
            ordinal: 0,
          },
        ],
      });
      const stored = await evidence.get(scope, row.id);
      const locator = stored.locator as {
        blockId: string;
        documentVersionId: string;
        page: number;
      };
      expect(locator.documentVersionId).toBe(versionId);
      const block = await extract.findBlock(locator.blockId);
      expect(block?.documentVersionId).toBe(versionId);
      expect(block?.text).toBe(blockText);
    });
  });
});
