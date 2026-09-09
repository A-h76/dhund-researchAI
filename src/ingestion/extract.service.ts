import { Inject, Injectable } from '@nestjs/common';
import {
  EXTRACT_STORE,
  L0ConnectionError,
  L0OperationError,
  OBJECT_STORAGE_SERVICE,
  PDF_PARSE_SERVICE,
  type ExtractStore,
  type ObjectStorageService,
  type PdfParseService,
} from '../l0/ports';
import { generateId } from '../platform/ids/uuid-v7';
import { JobEnqueueService } from '../platform/logging';
import { CHUNKER_VERSION, EXTRACTION_OK } from './extract.constants';
import { blocksFromPages } from './extract.blocks';
import { ExtractMetrics, type ExtractFailureCause } from './extract.metrics';
import { MAX_UPLOAD_BYTES } from './upload.constants';

export class ExtractUnrecoverableError extends Error {
  readonly causeCode: ExtractFailureCause;

  constructor(causeCode: ExtractFailureCause, message: string) {
    super(message);
    this.name = 'ExtractUnrecoverableError';
    this.causeCode = causeCode;
  }
}

export type ExtractOutcome =
  | { readonly kind: 'extracted'; readonly blockCount: number; readonly idempotent: boolean }
  | { readonly kind: 'ocr'; readonly pageCount: number }
  | { readonly kind: 'skipped' };

export interface ExtractJobInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly documentVersionId: string;
  readonly contentHash: string;
  readonly extractorVersion: string;
  readonly onProgress?: () => Promise<void>;
}

@Injectable()
export class ExtractService {
  constructor(
    @Inject(EXTRACT_STORE) private readonly store: ExtractStore,
    @Inject(PDF_PARSE_SERVICE) private readonly parser: PdfParseService,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    private readonly enqueue: JobEnqueueService,
    private readonly metrics: ExtractMetrics,
  ) {}

  async run(input: ExtractJobInput): Promise<ExtractOutcome> {
    const started = Date.now();
    const version = await this.store.findVersion(input.documentVersionId);
    if (version === null) {
      this.metrics.recordFailure('version_missing');
      throw new ExtractUnrecoverableError('version_missing', 'Document version not found');
    }
    if (version.deletedAt !== null) {
      return { kind: 'skipped' };
    }

    await this.store.markDocumentStatus(version.documentId, 'processing');

    const existing = await this.store.findExtraction(
      version.id,
      input.extractorVersion,
      input.contentHash,
    );
    if (existing !== null && existing.status === EXTRACTION_OK) {
      await this.enqueueChunk(input, version.projectId);
      return { kind: 'extracted', blockCount: (await this.store.listBlocks(version.id)).length, idempotent: true };
    }

    const bytes = await this.readBytes(version.storageKey);
    if (bytes === null) {
      this.metrics.recordFailure('storage');
      throw new Error('Object bytes missing');
    }

    const parsed = await this.parser.parse(bytes);
    await input.onProgress?.();

    switch (parsed.kind) {
      case 'invalid': {
        this.metrics.recordFailure('invalid_pdf');
        throw new ExtractUnrecoverableError('invalid_pdf', parsed.reason);
      }
      case 'needs_ocr': {
        this.metrics.recordOcrRoute(parsed.pageCount);
        await this.enqueueOcr(input, version.projectId, parsed.pageCount);
        return { kind: 'ocr', pageCount: parsed.pageCount };
      }
      case 'text': {
        const blocks = blocksFromPages(parsed.pages, generateId);
        const insert = await this.store.insertExtractionWithBlocks({
          extractionId: generateId(),
          documentVersionId: version.id,
          extractorVersion: input.extractorVersion,
          contentHash: input.contentHash,
          blocks,
        });
        await this.enqueueChunk(input, version.projectId);
        this.metrics.recordSuccess(parsed.pages.length, Date.now() - started);
        return {
          kind: 'extracted',
          blockCount: blocks.length,
          idempotent: insert === 'existing',
        };
      }
      default: {
        const exhaustive: never = parsed;
        return exhaustive;
      }
    }
  }

  async failDocument(documentVersionId: string): Promise<void> {
    const version = await this.store.findVersion(documentVersionId);
    if (version === null || version.deletedAt !== null) {
      return;
    }
    await this.store.markDocumentStatus(version.documentId, 'failed');
  }

  private async readBytes(storageKey: string): Promise<Buffer | null> {
    try {
      return await this.storage.getObjectBytes(storageKey, MAX_UPLOAD_BYTES);
    } catch (error) {
      this.metrics.recordFailure('storage');
      if (error instanceof L0ConnectionError || error instanceof L0OperationError) {
        throw error;
      }
      throw new Error('Object read failed');
    }
  }

  private async enqueueChunk(input: ExtractJobInput, projectId: string): Promise<void> {
    await this.enqueue.enqueue('chunk', {
      orgId: input.orgId,
      projectId,
      documentVersionId: input.documentVersionId,
      chunkerVersion: CHUNKER_VERSION,
      contentHash: input.contentHash,
    });
  }

  private async enqueueOcr(
    input: ExtractJobInput,
    projectId: string,
    pageCount: number,
  ): Promise<void> {
    const blockRefs = Array.from({ length: pageCount }, (_, index) => index + 1);
    await this.enqueue.enqueue('ocr', {
      orgId: input.orgId,
      projectId,
      documentVersionId: input.documentVersionId,
      extractorVersion: input.extractorVersion,
      contentHash: input.contentHash,
      blockRefs,
    });
  }
}
