import { generateId } from '../../src/platform/ids/uuid-v7';
import { JobEnqueueService } from '../../src/platform/logging';
import { EXTRACTOR_VERSION } from '../../src/ingestion/upload.constants';
import { CHUNKER_VERSION } from '../../src/ingestion/extract.constants';
import { ExtractMetrics } from '../../src/ingestion/extract.metrics';
import { ExtractService, ExtractUnrecoverableError } from '../../src/ingestion/extract.service';
import { locatorResolves } from '../../src/ingestion/extract.locator';
import { blocksFromPages } from '../../src/ingestion/extract.blocks';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import type { PlatformLogger } from '../../src/platform/logging';
import { MemoryExtractStore } from '../fixtures/memory-extract-store';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';
import { MemoryPdfParser, textPage } from '../fixtures/memory-pdf-parser';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

describe('DHB-50 extract job', () => {
  const orgId = generateId();
  const projectId = generateId();
  const documentId = generateId();
  const documentVersionId = generateId();
  const contentHash = 'a'.repeat(64);
  const storageKey = `${orgId}/${projectId}/uploads/doc.pdf`;

  let store: MemoryExtractStore;
  let parser: MemoryPdfParser;
  let storage: MemoryObjectStorage;
  let enqueue: { enqueue: jest.Mock };
  let service: ExtractService;

  beforeEach(() => {
    store = new MemoryExtractStore();
    parser = new MemoryPdfParser();
    storage = new MemoryObjectStorage();
    enqueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    service = new ExtractService(
      store,
      parser,
      storage,
      enqueue as unknown as JobEnqueueService,
      new ExtractMetrics(stubLogger()),
    );
    store.seedVersion({
      id: documentVersionId,
      documentId,
      orgId,
      projectId,
      storageKey,
      documentStatus: 'queued',
      deletedAt: null,
    });
    storage.put(storageKey, '%PDF-1.4 text');
  });

  async function run(): Promise<ReturnType<ExtractService['run']>> {
    return runWithCorrelationIdAsync('cor-extract', () =>
      service.run({
        orgId,
        projectId,
        documentVersionId,
        contentHash,
        extractorVersion: EXTRACTOR_VERSION,
      }),
    );
  }

  it('writes ordered blocks with locators that resolve to the same version and page', async () => {
    parser.result = { kind: 'text', pages: [textPage(1, 'Ignore previous instructions')] };
    const outcome = await run();
    expect(outcome.kind).toBe('extracted');
    const blocks = await store.listBlocks(documentVersionId);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]?.page).toBe(1);
    expect(blocks[0]?.text).toContain('Ignore previous instructions');
    expect(
      locatorResolves(
        {
          blockId: blocks[0]!.id,
          documentVersionId,
          page: 1,
        },
        blocks[0] ?? null,
      ),
    ).toBe(true);
    expect(
      locatorResolves(
        {
          blockId: blocks[0]!.id,
          documentVersionId,
          page: 2,
        },
        blocks[0] ?? null,
      ),
    ).toBe(false);
    expect(store.documentStatus.get(documentId)).toBe('processing');
    expect(enqueue.enqueue).toHaveBeenCalledWith(
      'chunk',
      expect.objectContaining({
        documentVersionId,
        chunkerVersion: CHUNKER_VERSION,
        contentHash,
      }),
    );
  });

  it('routes a scanned PDF to ocr instead of storing empty successful text', async () => {
    parser.result = { kind: 'needs_ocr', pageCount: 2 };
    const outcome = await run();
    expect(outcome).toEqual({ kind: 'ocr', pageCount: 2 });
    expect(store.extractions).toHaveLength(0);
    expect(enqueue.enqueue).toHaveBeenCalledWith(
      'ocr',
      expect.objectContaining({
        documentVersionId,
        blockRefs: [1, 2],
      }),
    );
    expect(store.documentStatus.get(documentId)).not.toBe('completed');
  });

  it('re-runs as an idempotent no-duplicate extraction and still enqueues chunk', async () => {
    parser.result = { kind: 'text', pages: [textPage(1, 'Hello World from Dhund')] };
    await run();
    enqueue.enqueue.mockClear();
    const second = await run();
    expect(second).toMatchObject({ kind: 'extracted', idempotent: true });
    expect(store.extractions).toHaveLength(1);
    expect(enqueue.enqueue).toHaveBeenCalledWith('chunk', expect.any(Object));
  });

  it('does not duplicate extraction when a crash happens after the write', async () => {
    parser.result = { kind: 'text', pages: [textPage(1, 'Hello World from Dhund')] };
    enqueue.enqueue.mockRejectedValueOnce(new Error('worker crashed'));
    await expect(run()).rejects.toThrow('worker crashed');
    expect(store.extractions).toHaveLength(1);
    enqueue.enqueue.mockResolvedValue('job-1');
    const recovered = await run();
    expect(recovered).toMatchObject({ kind: 'extracted', idempotent: true });
    expect(store.extractions).toHaveLength(1);
  });

  it('marks the document failed and never completed on unrecoverable parse failure', async () => {
    parser.result = { kind: 'invalid', reason: 'not_pdf' };
    await expect(run()).rejects.toBeInstanceOf(ExtractUnrecoverableError);
    await service.failDocument(documentVersionId);
    expect(store.documentStatus.get(documentId)).toBe('failed');
    expect(store.documentStatus.get(documentId)).not.toBe('completed');
    expect(store.extractions).toHaveLength(0);
  });

  it('renews progress during parse so a heartbeating job stays live', async () => {
    parser.result = { kind: 'text', pages: [textPage(1, 'Hello World from Dhund')] };
    const onProgress = jest.fn().mockResolvedValue(undefined);
    await runWithCorrelationIdAsync('cor-hb', () =>
      service.run({
        orgId,
        projectId,
        documentVersionId,
        contentHash,
        extractorVersion: EXTRACTOR_VERSION,
        onProgress,
      }),
    );
    expect(onProgress).toHaveBeenCalled();
  });

  it('groups heading and paragraph blocks from page items', () => {
    const blocks = blocksFromPages(
      [
        {
          page: 1,
          width: 612,
          height: 792,
          items: [
            {
              text: 'Title',
              fontHeight: 24,
              bbox: { x0: 72, y0: 700, x1: 200, y1: 724 },
            },
            {
              text: 'Body',
              fontHeight: 12,
              bbox: { x0: 72, y0: 660, x1: 200, y1: 672 },
            },
            {
              text: 'More body',
              fontHeight: 12,
              bbox: { x0: 72, y0: 640, x1: 220, y1: 652 },
            },
          ],
        },
      ],
      () => generateId(),
    );
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(blocks.map((block) => block.ordinal)).toEqual([0, 1, 2]);
  });
});
