import { Inject, Injectable } from '@nestjs/common';
import {
  DOCUMENT_INGESTION_STORE,
  type CreateBlockInput,
  type DocumentIngestionStore,
} from '../../l0/ports/document-ingestion.port';
import type { ObjectStorageService } from '../../l0/ports/object-storage.port';
import { OBJECT_STORAGE_SERVICE } from '../../l0/ports/tokens';
import { generateId } from '../../platform/ids/uuid-v7';
import { JobEnqueueService } from '../../platform/logging/job-enqueue.service';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import {
  CHUNKER_VERSION,
  EXTRACTION_STATUS,
  EXTRACTOR_VERSION,
} from './extract.constants';
import { ExtractError } from './extract.errors';
import { ExtractMetrics } from './extract.metrics';
import { PDF_PARSER, type PdfParser } from './pdf-parser.port';

export interface ExtractJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly documentVersionId: string;
  readonly contentHash: string;
  readonly extractorVersion: string;
  readonly correlationId: string;
}

export type ExtractOutcome =
  | { readonly kind: 'extracted'; readonly extractionId: string; readonly blockCount: number }
  | { readonly kind: 'routed_ocr'; readonly extractionId: string }
  | { readonly kind: 'idempotent'; readonly extractionId: string; readonly status: string };

@Injectable()
export class ExtractService {
  constructor(
    @Inject(DOCUMENT_INGESTION_STORE) private readonly store: DocumentIngestionStore,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    @Inject(PDF_PARSER) private readonly pdfParser: PdfParser,
    private readonly enqueue: JobEnqueueService,
    private readonly logger: PlatformLogger,
    private readonly metrics: ExtractMetrics,
  ) {}

  async execute(
    payload: ExtractJobPayload,
    options?: { onHeartbeat?: () => Promise<void> },
  ): Promise<ExtractOutcome> {
    const extractorVersion = payload.extractorVersion || EXTRACTOR_VERSION;
    const existing = await this.store.findExtraction(
      payload.documentVersionId,
      extractorVersion,
      payload.contentHash,
    );

    if (existing !== null) {
      await this.enqueueDownstream(existing.status, payload, extractorVersion);
      return {
        kind: 'idempotent',
        extractionId: existing.id,
        status: existing.status,
      };
    }

    const version = await this.store.getVersionWithDocument(payload.documentVersionId);
    if (version === null) {
      this.metrics.recordFailure('missing_version');
      throw new ExtractError(
        `Document version "${payload.documentVersionId}" was not found`,
        false,
        'missing_version',
      );
    }

    await this.store.markDocumentStatus(version.documentId, 'processing');
    await options?.onHeartbeat?.();

    let pdfBytes: Buffer;
    try {
      pdfBytes = await this.storage.getObject(version.storageKey);
    } catch (error) {
      this.metrics.recordFailure('storage_error');
      throw new ExtractError('Failed to download document bytes', true, 'storage_error', {
        cause: error,
      });
    }

    await options?.onHeartbeat?.();

    const parseStarted = Date.now();
    let parsed;
    try {
      parsed = await this.pdfParser.parse(pdfBytes);
    } catch (error) {
      this.metrics.recordFailure('parse_error');
      await this.store.markDocumentStatus(version.documentId, 'failed');
      throw new ExtractError('PDF parse failed', false, 'parse_error', { cause: error });
    }

    this.metrics.recordParse(parsed.pageCount, Date.now() - parseStarted);
    await options?.onHeartbeat?.();

    // Document body / title are untrusted data — stored as text, never executed.
    const titleAsData = version.document.title;

    if (!parsed.hasExtractableTextLayer) {
      this.metrics.recordOcrRoute();
      const extractionId = generateId();
      try {
        await this.store.createExtractionWithBlocks({
          extractionId,
          documentVersionId: payload.documentVersionId,
          documentId: version.documentId,
          extractorVersion,
          contentHash: payload.contentHash,
          status: EXTRACTION_STATUS.NeedsOcr,
          producedAt: new Date(),
          blocks: [],
          documentStatus: 'processing',
        });
      } catch (error) {
        const raced = await this.store.findExtraction(
          payload.documentVersionId,
          extractorVersion,
          payload.contentHash,
        );
        if (raced !== null) {
          await this.enqueueDownstream(raced.status, payload, extractorVersion);
          return {
            kind: 'idempotent',
            extractionId: raced.id,
            status: raced.status,
          };
        }
        this.metrics.recordFailure('persist_error');
        await this.store.markDocumentStatus(version.documentId, 'failed');
        throw new ExtractError('Failed to persist OCR routing extraction', false, 'persist_error', {
          cause: error,
        });
      }

      await this.enqueue.enqueue('ocr', {
        orgId: payload.orgId,
        projectId: payload.projectId,
        documentVersionId: payload.documentVersionId,
        contentHash: payload.contentHash,
        extractorVersion,
        blockRefs: [],
      });

      this.logger.info({
        module: 'ingestion',
        message: 'extract.routed_ocr',
        documentVersionId: payload.documentVersionId,
        extractionId,
        titleLength: titleAsData.length,
        pageCount: parsed.pageCount,
      });

      return { kind: 'routed_ocr', extractionId };
    }

    const blocks = buildBlocks(parsed.pages);
    const extractionId = generateId();

    try {
      await this.store.createExtractionWithBlocks({
        extractionId,
        documentVersionId: payload.documentVersionId,
        documentId: version.documentId,
        extractorVersion,
        contentHash: payload.contentHash,
        status: EXTRACTION_STATUS.Ok,
        producedAt: new Date(),
        blocks,
        documentStatus: 'processing',
      });
    } catch (error) {
      const raced = await this.store.findExtraction(
        payload.documentVersionId,
        extractorVersion,
        payload.contentHash,
      );
      if (raced !== null) {
        await this.enqueueDownstream(raced.status, payload, extractorVersion);
        return {
          kind: 'idempotent',
          extractionId: raced.id,
          status: raced.status,
        };
      }
      this.metrics.recordFailure('persist_error');
      await this.store.markDocumentStatus(version.documentId, 'failed');
      throw new ExtractError('Failed to persist document extraction', false, 'persist_error', {
        cause: error,
      });
    }

    await this.enqueue.enqueue('chunk', {
      orgId: payload.orgId,
      projectId: payload.projectId,
      documentVersionId: payload.documentVersionId,
      contentHash: payload.contentHash,
      chunkerVersion: CHUNKER_VERSION,
    });

    this.logger.info({
      module: 'ingestion',
      message: 'extract.completed',
      documentVersionId: payload.documentVersionId,
      extractionId,
      blockCount: blocks.length,
      pageCount: parsed.pageCount,
    });

    return {
      kind: 'extracted',
      extractionId,
      blockCount: blocks.length,
    };
  }

  private async enqueueDownstream(
    status: string,
    payload: ExtractJobPayload,
    extractorVersion: string,
  ): Promise<void> {
    if (status === EXTRACTION_STATUS.NeedsOcr) {
      await this.enqueue.enqueue('ocr', {
        orgId: payload.orgId,
        projectId: payload.projectId,
        documentVersionId: payload.documentVersionId,
        contentHash: payload.contentHash,
        extractorVersion,
        blockRefs: [],
      });
      return;
    }

    if (status === EXTRACTION_STATUS.Ok) {
      await this.enqueue.enqueue('chunk', {
        orgId: payload.orgId,
        projectId: payload.projectId,
        documentVersionId: payload.documentVersionId,
        contentHash: payload.contentHash,
        chunkerVersion: CHUNKER_VERSION,
      });
    }
  }
}

function buildBlocks(
  pages: readonly { pageNumber: number; text: string }[],
): CreateBlockInput[] {
  const blocks: CreateBlockInput[] = [];
  let ordinal = 0;

  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (paragraphs.length === 0 && page.text.trim().length > 0) {
      paragraphs.push(page.text.trim());
    }

    for (const text of paragraphs) {
      blocks.push({
        id: generateId(),
        type: 'paragraph',
        page: page.pageNumber,
        text,
        ordinal,
        bbox: {
          page: page.pageNumber,
          ordinal,
          x: 0,
          y: ordinal,
          width: null,
          height: null,
        },
      });
      ordinal += 1;
    }
  }

  return blocks;
}
