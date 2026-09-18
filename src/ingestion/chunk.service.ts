import { Inject, Injectable } from '@nestjs/common';
import {
  CHUNK_STORE,
  DocumentTransitionError,
  EXTRACT_STORE,
  type ChunkInsert,
  type ChunkStore,
  type ExtractStore,
  type ExtractVersionRecord,
  type OutboxInsertInput,
} from '../l0/ports';
import { generateId } from '../platform/ids/uuid-v7';
import { JobEnqueueService } from '../platform/logging';
import { OutboxWriterService } from '../platform/events/outbox-writer.service';
import { buildChunksFromBlocks, isChunkStale, type BuiltChunk } from './chunk.blocks';
import { EMBED_MODEL_VERSION } from './chunk.constants';
import { ChunkMetrics, type ChunkFailureCause } from './chunk.metrics';

export class ChunkUnrecoverableError extends Error {
  readonly causeCode: ChunkFailureCause;

  constructor(causeCode: ChunkFailureCause, message: string) {
    super(message);
    this.name = 'ChunkUnrecoverableError';
    this.causeCode = causeCode;
  }
}

export type ChunkOutcome =
  | {
      readonly kind: 'chunked';
      readonly chunkCount: number;
      readonly createdCount: number;
      readonly reusedCount: number;
      readonly partial: boolean;
      readonly idempotent: boolean;
    }
  | { readonly kind: 'skipped' };

export interface ChunkJobInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly documentVersionId: string;
  readonly chunkerVersion: string;
  readonly contentHash: string;
  readonly onProgress?: () => Promise<void>;
}

/**
 * DHB-52 chunk job. Reads document_blocks ONLY — never re-parses the PDF and
 * never touches object storage. chunks.text is written once as a derived
 * projection of blocks; content-addressed chunks skip re-embedding.
 */
@Injectable()
export class ChunkService {
  constructor(
    @Inject(EXTRACT_STORE) private readonly extractStore: ExtractStore,
    @Inject(CHUNK_STORE) private readonly chunkStore: ChunkStore,
    private readonly outboxWriter: OutboxWriterService,
    private readonly enqueue: JobEnqueueService,
    private readonly metrics: ChunkMetrics,
  ) {}

  async run(input: ChunkJobInput): Promise<ChunkOutcome> {
    const started = Date.now();
    const version = await this.extractStore.findVersion(input.documentVersionId);
    if (version === null) {
      this.metrics.recordFailure('version_missing');
      throw new ChunkUnrecoverableError('version_missing', 'Document version not found');
    }
    if (version.deletedAt !== null) {
      return { kind: 'skipped' };
    }

    const blocks = await this.extractStore.listBlocks(version.id);
    if (blocks.length === 0) {
      this.metrics.recordFailure('no_blocks');
      throw new ChunkUnrecoverableError('no_blocks', 'No document blocks to chunk');
    }

    const built = buildChunksFromBlocks(blocks, generateId);
    await input.onProgress?.();

    const existing = await this.chunkStore.listChunks(version.id, input.chunkerVersion);
    // Blocks are authoritative: a stored chunk whose projection no longer
    // matches blocks is stale. It is never mutated in place — recomputed
    // content produces new content-addressed rows instead.
    const staleDetected = existing.filter((chunk) => isChunkStale(chunk, blocks)).length;
    const existingByHash = new Map(existing.map((chunk) => [chunk.contentHash, chunk]));
    const newChunks = built.filter((chunk) => !existingByHash.has(chunk.contentHash));

    const priorHashes = new Set(
      await this.chunkStore.listPriorVersionHashes(
        version.documentId,
        version.id,
        input.chunkerVersion,
      ),
    );

    const partial = version.documentStatus === 'partial';
    const idempotent =
      newChunks.length === 0 &&
      existing.length > 0 &&
      (version.documentStatus === 'completed' || partial);

    if (!idempotent) {
      await this.commit(input, version, built, newChunks, partial);
    }

    // Content-addressed reuse: unchanged content skips re-embedding.
    const embedTargets = built.filter((chunk) => !priorHashes.has(chunk.contentHash));
    for (const chunk of embedTargets) {
      const chunkId = existingByHash.get(chunk.contentHash)?.id ?? chunk.id;
      await this.enqueue.enqueue('embed', {
        orgId: input.orgId,
        projectId: version.projectId,
        chunkId,
        modelVersion: EMBED_MODEL_VERSION,
        contentHash: chunk.contentHash,
      });
    }

    const reusedCount = built.length - embedTargets.length;
    this.metrics.recordSuccess({
      chunkCount: built.length,
      createdCount: idempotent ? 0 : newChunks.length,
      reusedCount,
      durationMs: Date.now() - started,
      partial,
      staleDetected,
    });
    return {
      kind: 'chunked',
      chunkCount: built.length,
      createdCount: idempotent ? 0 : newChunks.length,
      reusedCount,
      partial,
      idempotent,
    };
  }

  async failDocument(documentVersionId: string): Promise<void> {
    const version = await this.extractStore.findVersion(documentVersionId);
    if (version === null || version.deletedAt !== null) {
      return;
    }
    try {
      await this.chunkStore.commitChunks({
        documentId: version.documentId,
        chunks: [],
        toStatus: 'failed',
        outboxEvents: [
          this.buildDocumentEvent('ingestion.document.failed', version, {
            stage: 'chunk',
          }),
        ],
      });
    } catch (error) {
      if (error instanceof DocumentTransitionError) {
        this.metrics.recordFailure('forbidden_transition');
        return;
      }
      throw error;
    }
  }

  private async commit(
    input: ChunkJobInput,
    version: ExtractVersionRecord,
    built: readonly BuiltChunk[],
    newChunks: readonly BuiltChunk[],
    partial: boolean,
  ): Promise<void> {
    const events: OutboxInsertInput[] = [
      this.buildDocumentEvent('ingestion.document.chunked', version, {
        chunkCount: built.length,
        chunkerVersion: input.chunkerVersion,
      }),
      partial
        ? this.buildDocumentEvent('ingestion.document.partial', version, {})
        : this.buildDocumentEvent('ingestion.document.completed', version, {}),
    ];

    const inserts: ChunkInsert[] = newChunks.map((chunk) => ({
      id: chunk.id,
      documentVersionId: version.id,
      projectId: version.projectId,
      ordinal: chunk.ordinal,
      charSpan: chunk.charSpan,
      tokenCount: chunk.tokenCount,
      page: chunk.page,
      section: null,
      blockIds: chunk.blockIds,
      contentHash: chunk.contentHash,
      chunkerVersion: input.chunkerVersion,
      text: chunk.text,
    }));

    try {
      await this.chunkStore.commitChunks({
        documentId: version.documentId,
        chunks: inserts,
        // A partial chain never becomes completed.
        toStatus: partial ? null : 'completed',
        outboxEvents: events,
      });
    } catch (error) {
      if (error instanceof DocumentTransitionError) {
        this.metrics.recordFailure('forbidden_transition');
        throw new ChunkUnrecoverableError('forbidden_transition', error.message);
      }
      this.metrics.recordFailure('commit');
      throw error;
    }
  }

  private buildDocumentEvent(
    eventType:
      | 'ingestion.document.chunked'
      | 'ingestion.document.completed'
      | 'ingestion.document.partial'
      | 'ingestion.document.failed',
    version: ExtractVersionRecord,
    extra: Record<string, unknown>,
  ): OutboxInsertInput {
    return this.outboxWriter.buildInsert({
      eventType,
      aggregateType: 'document',
      aggregateId: version.documentId,
      orgId: version.orgId,
      projectId: version.projectId,
      payload: {
        orgId: version.orgId,
        projectId: version.projectId,
        documentId: version.documentId,
        documentVersionId: version.id,
        ...extra,
      },
    });
  }
}
