import { Inject, Injectable } from '@nestjs/common';
import { EMBEDDING_STORE, type EmbeddingStore } from '../../l0/ports';
import { EMBED_BACKFILL_PAGE_SIZE } from './embed.constants';
import { EmbedService } from './embed.service';
import { EmbedMetrics } from './embed.metrics';
import {
  parseEmbedBackfillRequest,
  type EmbedBackfillRequest,
} from './embed-backfill.payload';

export interface EmbedBackfillOutcome {
  readonly scanned: number;
  readonly written: number;
  readonly skipped: number;
  readonly batchId: string;
}

export interface EmbedBackfillJobInput {
  readonly payload: unknown;
  readonly onProgress?: () => Promise<void>;
}

/**
 * GAP-ADMIN-JOB-01 backfill runner. This is the one embed path permitted to
 * target a non-write-active model version: a new version is populated here
 * before it is flipped, and the previous version's rows and index stay intact.
 */
@Injectable()
export class EmbedBackfillService {
  constructor(
    @Inject(EMBEDDING_STORE) private readonly store: EmbeddingStore,
    private readonly embed: EmbedService,
    private readonly metrics: EmbedMetrics,
  ) {}

  async run(input: EmbedBackfillJobInput): Promise<EmbedBackfillOutcome> {
    const request = parseEmbedBackfillRequest(input.payload);

    let afterChunkId: string | null = null;
    let scanned = 0;
    let written = 0;
    let skipped = 0;

    for (;;) {
      const page = await this.store.listChunksInScope(toScopeQuery(request, afterChunkId));
      if (page.length === 0) {
        break;
      }

      const result = await this.embed.embedChunks({
        orgId: request.orgId,
        chunks: page,
        modelVersion: request.modelVersion,
        ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}),
      });

      scanned += page.length;
      written += result.written;
      skipped += result.skipped;

      this.metrics.recordBackfillProgress({
        batchId: request.batchId,
        modelVersion: request.modelVersion,
        scanned: page.length,
        written: result.written,
        skipped: result.skipped,
      });

      await input.onProgress?.();
      afterChunkId = page[page.length - 1]!.chunkId;

      if (page.length < EMBED_BACKFILL_PAGE_SIZE) {
        break;
      }
    }

    return { scanned, written, skipped, batchId: request.batchId };
  }
}

function toScopeQuery(request: EmbedBackfillRequest, afterChunkId: string | null) {
  return {
    orgId: request.orgId,
    projectIds: request.scope.projects.length > 0 ? request.scope.projects : null,
    documentIds: request.scope.documentIds.length > 0 ? request.scope.documentIds : null,
    afterChunkId,
    limit: EMBED_BACKFILL_PAGE_SIZE,
  };
}
