import { Inject, Injectable } from '@nestjs/common';
import {
  DocumentTransitionError,
  EMBEDDING_STORE,
  EXTRACT_STORE,
  EmbeddingDimensionMismatchError,
  embeddingKeyOf,
  type EmbeddableChunk,
  type EmbeddingInsert,
  type EmbeddingStore,
  type ExtractStore,
} from '../../l0/ports';
import { generateId } from '../../platform/ids/uuid-v7';
import { requireCorrelationId } from '../../platform/logging';
import { RuntimeRole } from '../../platform/runtime/role';
import type { IGatewayService } from '../gateway/gateway.port';
import type { GatewayResult } from '../gateway/gateway.types';
import { GatewayExecutionFailedError } from '../gateway/gateway-execution.errors';
import {
  EMBED_DOCUMENT_INPUT_TYPE,
  EMBED_DIMENSION,
  isWriteActiveEmbedModelVersion,
} from '../policy/embed-policy.constants';
import { GATEWAY_SERVICE } from '../tokens';
import { groupByProject, planEmbedBatches } from './embed.blocks';
import { EmbedMetrics, type EmbedFailureCause } from './embed.metrics';

export class EmbedUnrecoverableError extends Error {
  readonly causeCode: EmbedFailureCause;

  constructor(causeCode: EmbedFailureCause, message: string) {
    super(message);
    this.name = 'EmbedUnrecoverableError';
    this.causeCode = causeCode;
  }
}

export interface EmbedWriteResult {
  readonly written: number;
  readonly skipped: number;
}

export type EmbedOutcome =
  | { readonly kind: 'embedded'; readonly written: number; readonly idempotent: boolean }
  | { readonly kind: 'skipped' };

export interface EmbedJobInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly chunkId: string;
  readonly modelVersion: string;
  readonly contentHash: string;
  readonly onProgress?: () => Promise<void>;
}

export interface EmbedChunksInput {
  readonly orgId: string;
  readonly chunks: readonly EmbeddableChunk[];
  readonly modelVersion: string;
  readonly onProgress?: () => Promise<void>;
}

/**
 * DHB-53 embed job. Gateway EMBED is the only write path — this module holds no
 * provider client and no provider SDK import (GAP-EMBED-01). Stored chunks embed
 * with input_type=document; dimension is schema-bound and enforced on write.
 */
@Injectable()
export class EmbedService {
  constructor(
    @Inject(EMBEDDING_STORE) private readonly store: EmbeddingStore,
    @Inject(EXTRACT_STORE) private readonly extractStore: ExtractStore,
    @Inject(GATEWAY_SERVICE) private readonly gateway: IGatewayService,
    private readonly metrics: EmbedMetrics,
  ) {}

  async run(input: EmbedJobInput): Promise<EmbedOutcome> {
    // Exactly one version is write-active; embed-backfill is the only job
    // allowed to target another one.
    if (!isWriteActiveEmbedModelVersion(input.modelVersion)) {
      this.metrics.recordFailure('inactive_model_version');
      throw new EmbedUnrecoverableError(
        'inactive_model_version',
        `Model version "${input.modelVersion}" is not write-active`,
      );
    }

    const chunk = await this.store.findChunk(input.chunkId);
    if (chunk === null) {
      this.metrics.recordFailure('chunk_missing');
      throw new EmbedUnrecoverableError('chunk_missing', 'Chunk not found');
    }

    // The job carries the hash it was enqueued for; a re-chunked document
    // produces a new chunk row rather than re-embedding this one.
    if (chunk.contentHash !== input.contentHash) {
      return { kind: 'skipped' };
    }

    const result = await this.embedChunks({
      orgId: input.orgId,
      chunks: [chunk],
      modelVersion: input.modelVersion,
      ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}),
    });

    return {
      kind: 'embedded',
      written: result.written,
      idempotent: result.written === 0,
    };
  }

  async embedChunks(input: EmbedChunksInput): Promise<EmbedWriteResult> {
    const embedded = new Set(
      (
        await this.store.listEmbeddedKeys(
          input.modelVersion,
          input.chunks.map((chunk) => chunk.chunkId),
        )
      ).map((key) => embeddingKeyOf(key.chunkId, key.contentHash)),
    );

    const pending = input.chunks.filter(
      (chunk) => !embedded.has(embeddingKeyOf(chunk.chunkId, chunk.contentHash)),
    );
    const skipped = input.chunks.length - pending.length;

    let written = 0;
    for (const group of groupByProject(pending)) {
      const projectId = group[0]!.projectId;
      for (const batch of planEmbedBatches(group)) {
        written += await this.embedBatch(input.orgId, projectId, batch, input.modelVersion);
        await input.onProgress?.();
      }
    }

    this.metrics.recordWrite({ written, skipped, modelVersion: input.modelVersion });
    return { written, skipped };
  }

  /** Degrades the document behind a chunk to partial so consumers refuse it. */
  async markDocumentPartial(chunkId: string): Promise<void> {
    const chunk = await this.store.findChunk(chunkId);
    if (chunk === null) {
      return;
    }
    try {
      await this.extractStore.markDocumentStatus(chunk.documentId, 'partial');
      this.metrics.recordDocumentDegraded(chunk.documentId);
    } catch (error) {
      if (error instanceof DocumentTransitionError) {
        return;
      }
      throw error;
    }
  }

  private async embedBatch(
    orgId: string,
    projectId: string,
    batch: readonly EmbeddableChunk[],
    modelVersion: string,
  ): Promise<number> {
    const result = await this.execute(orgId, projectId, batch);

    if (result.vectors.length !== batch.length) {
      this.metrics.recordFailure('gateway');
      throw new EmbedUnrecoverableError(
        'gateway',
        `Gateway returned ${result.vectors.length} vectors for ${batch.length} texts`,
      );
    }

    this.metrics.recordRequest({
      textCount: batch.length,
      tokensIn: result.metrics.tokensIn,
      costMicros: result.metrics.costMicros,
      latencyMs: result.metrics.latencyMs,
      modelVersion,
    });

    const rows: EmbeddingInsert[] = batch.map((chunk, index) => ({
      id: generateId(),
      chunkId: chunk.chunkId,
      projectId: chunk.projectId,
      modelId: result.model,
      modelVersion,
      vector: result.vectors[index] as readonly number[],
      contentHash: chunk.contentHash,
    }));

    try {
      return await this.store.insertEmbeddings(rows);
    } catch (error) {
      if (error instanceof EmbeddingDimensionMismatchError) {
        this.metrics.recordFailure('dimension_mismatch');
        throw new EmbedUnrecoverableError('dimension_mismatch', error.message);
      }
      this.metrics.recordFailure('write');
      throw error;
    }
  }

  private async execute(
    orgId: string,
    projectId: string,
    batch: readonly EmbeddableChunk[],
  ): Promise<Extract<GatewayResult, { capability: 'EMBED' }>> {
    let result: GatewayResult;
    try {
      result = await this.gateway.execute(
        {
          orgId,
          projectId,
          correlationId: requireCorrelationId(),
          runtimeRole: RuntimeRole.Worker,
        },
        {
          capability: 'EMBED',
          texts: batch.map((chunk) => chunk.text),
          inputType: EMBED_DOCUMENT_INPUT_TYPE,
          expectedDimensions: batch.map(() => EMBED_DIMENSION),
        },
      );
    } catch (error) {
      this.metrics.recordFailure(isRateLimited(error) ? 'rate_limited' : 'gateway');
      throw error;
    }

    if (result.capability !== 'EMBED') {
      this.metrics.recordFailure('gateway');
      throw new EmbedUnrecoverableError('gateway', 'Gateway returned a non-EMBED result');
    }

    return result;
  }
}

/** The Voyage adapter retries 429 with backoff; a surviving 429 is observed here. */
function isRateLimited(error: unknown): boolean {
  const messages =
    error instanceof GatewayExecutionFailedError
      ? error.attemptErrors
      : [error instanceof Error ? error.message : String(error)];
  return messages.some((message) => /429|rate.?limit/i.test(message));
}
