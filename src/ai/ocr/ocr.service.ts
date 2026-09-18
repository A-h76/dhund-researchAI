import { Inject, Injectable } from '@nestjs/common';
import { EXTRACT_STORE, type ExtractStore } from '../../l0/ports';
import { generateId } from '../../platform/ids/uuid-v7';
import { JobEnqueueService, requireCorrelationId } from '../../platform/logging';
import { RuntimeRole } from '../../platform/runtime/role';
import { CHUNKER_VERSION, EXTRACTION_OK } from '../../ingestion/extract.constants';
import { OCR_MIN_CONFIDENCE } from '../../ingestion/ocr.constants';
import { blocksFromOcrPages } from '../../ingestion/ocr.blocks';
import type { IGatewayService } from '../gateway/gateway.port';
import type { GatewayResult } from '../gateway/gateway.types';
import { GatewayExecutionFailedError } from '../gateway/gateway-execution.errors';
import { GATEWAY_SERVICE } from '../tokens';
import { OcrMetrics, type OcrFailureCause } from './ocr.metrics';

export class OcrUnrecoverableError extends Error {
  readonly causeCode: OcrFailureCause;

  constructor(causeCode: OcrFailureCause, message: string) {
    super(message);
    this.name = 'OcrUnrecoverableError';
    this.causeCode = causeCode;
  }
}

export type OcrOutcome =
  | { readonly kind: 'ocr'; readonly blockCount: number; readonly partial: boolean; readonly idempotent: boolean }
  | { readonly kind: 'skipped' };

export interface OcrJobInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly documentVersionId: string;
  readonly contentHash: string;
  readonly extractorVersion: string;
  readonly onProgress?: () => Promise<void>;
}

@Injectable()
export class OcrService {
  constructor(
    @Inject(EXTRACT_STORE) private readonly store: ExtractStore,
    @Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService,
    private readonly enqueue: JobEnqueueService,
    private readonly metrics: OcrMetrics,
  ) {}

  async run(input: OcrJobInput): Promise<OcrOutcome> {
    const started = Date.now();
    const version = await this.store.findVersion(input.documentVersionId);
    if (version === null) {
      this.metrics.recordFailure('version_missing');
      throw new OcrUnrecoverableError('version_missing', 'Document version not found');
    }
    if (version.deletedAt !== null) {
      return { kind: 'skipped' };
    }

    const existing = await this.store.findExtraction(
      version.id,
      input.extractorVersion,
      input.contentHash,
    );
    if (existing !== null && existing.status === EXTRACTION_OK) {
      await this.enqueueChunk(input, version.projectId);
      return {
        kind: 'ocr',
        blockCount: (await this.store.listBlocks(version.id)).length,
        partial: version.documentStatus === 'partial',
        idempotent: true,
      };
    }

    await this.store.markDocumentStatus(version.documentId, 'processing');
    await input.onProgress?.();

    const result = await this.executeOcr(input, version.storageKey, version.projectId);
    if (result.capability !== 'OCR') {
      this.metrics.recordFailure('gateway');
      throw new OcrUnrecoverableError('gateway', 'Gateway returned a non-OCR result');
    }

    const blocks = blocksFromOcrPages(result.pages, generateId);
    if (blocks.length === 0) {
      this.metrics.recordFailure('empty_ocr');
      throw new OcrUnrecoverableError('empty_ocr', 'OCR produced no text');
    }

    await this.store.insertExtractionWithBlocks({
      extractionId: generateId(),
      documentVersionId: version.id,
      extractorVersion: input.extractorVersion,
      contentHash: input.contentHash,
      blocks,
    });

    const partial = result.meanConfidence < OCR_MIN_CONFIDENCE;
    await this.store.markDocumentStatus(version.documentId, partial ? 'partial' : 'processing');
    await this.enqueueChunk(input, version.projectId);
    this.metrics.recordSuccess({
      pages: result.pages.length,
      durationMs: Date.now() - started,
      costMicros: result.metrics.costMicros,
      meanConfidence: result.meanConfidence,
      partial,
    });
    return { kind: 'ocr', blockCount: blocks.length, partial, idempotent: false };
  }

  async failDocument(documentVersionId: string): Promise<void> {
    const version = await this.store.findVersion(documentVersionId);
    if (version === null || version.deletedAt !== null) {
      return;
    }
    await this.store.markDocumentStatus(version.documentId, 'failed');
  }

  private async executeOcr(
    input: OcrJobInput,
    objectKey: string,
    projectId: string,
  ): Promise<GatewayResult> {
    try {
      return await this.gateway.execute(
        {
          orgId: input.orgId,
          projectId,
          correlationId: requireCorrelationId(),
          runtimeRole: RuntimeRole.Worker,
        },
        {
          capability: 'OCR',
          objectKey,
        },
      );
    } catch (error) {
      this.metrics.recordFailure('gateway');
      if (error instanceof GatewayExecutionFailedError) {
        throw error;
      }
      throw error;
    }
  }

  private async enqueueChunk(input: OcrJobInput, projectId: string): Promise<void> {
    await this.enqueue.enqueue('chunk', {
      orgId: input.orgId,
      projectId,
      documentVersionId: input.documentVersionId,
      chunkerVersion: CHUNKER_VERSION,
      contentHash: input.contentHash,
    });
  }
}
