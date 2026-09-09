import { PdfjsParseAdapter } from '../../src/l0/adapters/pdfjs/pdfjs-parse.adapter';
import { scannedPdf, textLayerPdf } from '../fixtures/minimal-pdf';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { EXTRACTOR_VERSION } from '../../src/ingestion/upload.constants';
import { ExtractService } from '../../src/ingestion/extract.service';
import { ExtractMetrics } from '../../src/ingestion/extract.metrics';
import { JobEnqueueService } from '../../src/platform/logging';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import type { PlatformLogger } from '../../src/platform/logging';
import { MemoryExtractStore } from '../fixtures/memory-extract-store';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

(integrationEnabled ? describe : describe.skip)('DHB-50 extract (real PDFs)', () => {
  it('parses a text PDF and OCRs a scanned PDF through the live adapter', async () => {
    const parser = new PdfjsParseAdapter();
    const store = new MemoryExtractStore();
    const storage = new MemoryObjectStorage();
    const enqueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as PlatformLogger;
    const service = new ExtractService(
      store,
      parser,
      storage,
      enqueue as unknown as JobEnqueueService,
      new ExtractMetrics(logger),
    );

    const orgId = generateId();
    const projectId = generateId();
    const documentId = generateId();
    const versionId = generateId();
    const storageKey = `${orgId}/${projectId}/docs/a.pdf`;
    store.seedVersion({
      id: versionId,
      documentId,
      orgId,
      projectId,
      storageKey,
      documentStatus: 'queued',
      deletedAt: null,
    });
    storage.put(storageKey, textLayerPdf('Dhund extract integration'));

    const first = await runWithCorrelationIdAsync('cor-int', () =>
      service.run({
        orgId,
        projectId,
        documentVersionId: versionId,
        contentHash: 'b'.repeat(64),
        extractorVersion: EXTRACTOR_VERSION,
      }),
    );
    expect(first.kind).toBe('extracted');
    const second = await runWithCorrelationIdAsync('cor-int-2', () =>
      service.run({
        orgId,
        projectId,
        documentVersionId: versionId,
        contentHash: 'b'.repeat(64),
        extractorVersion: EXTRACTOR_VERSION,
      }),
    );
    expect(second).toMatchObject({ kind: 'extracted', idempotent: true });

    const scannedKey = `${orgId}/${projectId}/docs/scan.pdf`;
    const scannedVersion = generateId();
    store.seedVersion({
      id: scannedVersion,
      documentId: generateId(),
      orgId,
      projectId,
      storageKey: scannedKey,
      documentStatus: 'queued',
      deletedAt: null,
    });
    storage.put(scannedKey, scannedPdf());
    const ocr = await runWithCorrelationIdAsync('cor-int-ocr', () =>
      service.run({
        orgId,
        projectId,
        documentVersionId: scannedVersion,
        contentHash: 'c'.repeat(64),
        extractorVersion: EXTRACTOR_VERSION,
      }),
    );
    expect(ocr.kind).toBe('ocr');
  });
});
