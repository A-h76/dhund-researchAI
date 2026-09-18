import { Injectable } from '@nestjs/common';
import type { RetrievalArm } from '../l0/ports';
import { PlatformLogger } from '../platform/logging';
import {
  FILTERED_RECALL_SHORTFALL_THRESHOLD,
  filteredRecallDropRate,
  filteredRecallShortfall,
} from './filtered-recall';

export type RetrievalLatencyStage = 'vector' | 'fts' | 'rrf' | 'rerank';

export interface RetrievalMetricsSnapshot {
  readonly vectorQueries: number;
  readonly ftsQueries: number;
  readonly vectorUnavailable: number;
  readonly ftsUnavailable: number;
  readonly lastEfSearch: number | null;
  readonly lastVectorMs: number | null;
  readonly lastFtsMs: number | null;
  readonly lastRrfMs: number | null;
  readonly lastRerankMs: number | null;
  readonly rerankLlm: number;
  readonly rerankFallbacks: number;
  readonly filteredRecallShortfall: number;
  readonly filteredRecallDropRate: number;
}

@Injectable()
export class RetrievalMetrics {
  private vectorQueries = 0;
  private ftsQueries = 0;
  private vectorUnavailable = 0;
  private ftsUnavailable = 0;
  private lastEfSearch: number | null = null;
  private lastVectorMs: number | null = null;
  private lastFtsMs: number | null = null;
  private lastRrfMs: number | null = null;
  private lastRerankMs: number | null = null;
  private rerankLlm = 0;
  private rerankFallbacks = 0;
  private shortfall = 0;
  private retrieved = 0;
  private surviving = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordVectorQuery(input: { readonly hitCount: number; readonly efSearch: number }): void {
    this.vectorQueries += 1;
    this.lastEfSearch = input.efSearch;
    this.logger.info({
      module: 'retrieval',
      message: 'retrieval.vector.completed',
      hitCount: input.hitCount,
      efSearch: input.efSearch,
    });
  }

  recordFtsQuery(hitCount: number): void {
    this.ftsQueries += 1;
    this.logger.info({
      module: 'retrieval',
      message: 'retrieval.fts.completed',
      hitCount,
    });
  }

  recordArmUnavailable(arm: RetrievalArm): void {
    switch (arm) {
      case 'vector':
        this.vectorUnavailable += 1;
        break;
      case 'fts':
        this.ftsUnavailable += 1;
        break;
      default: {
        const exhaustive: never = arm;
        throw new Error(`unknown retrieval arm ${String(exhaustive)}`);
      }
    }
    this.logger.warn({
      module: 'retrieval',
      message: 'retrieval.arm.unavailable',
      arm,
    });
  }

  recordStageLatency(stage: RetrievalLatencyStage, latencyMs: number): void {
    switch (stage) {
      case 'vector':
        this.lastVectorMs = latencyMs;
        break;
      case 'fts':
        this.lastFtsMs = latencyMs;
        break;
      case 'rrf':
        this.lastRrfMs = latencyMs;
        break;
      case 'rerank':
        this.lastRerankMs = latencyMs;
        break;
      default: {
        const exhaustive: never = stage;
        throw new Error(`unknown retrieval stage ${String(exhaustive)}`);
      }
    }
    this.logger.info({
      module: 'retrieval',
      message: 'retrieval.stage.latency',
      stage,
      latencyMs,
    });
  }

  recordRerankLlm(): void {
    this.rerankLlm += 1;
  }

  recordRerankFallback(): void {
    this.rerankFallbacks += 1;
    this.logger.info({
      module: 'retrieval',
      message: 'retrieval.rerank.fallback',
      method: 'deterministic',
    });
  }

  recordFilteredRecall(retrievedCount: number, survivingCount: number): number {
    const shortfall = filteredRecallShortfall(retrievedCount, survivingCount);
    const dropRate = filteredRecallDropRate(retrievedCount, survivingCount);
    this.shortfall += shortfall;
    this.retrieved += retrievedCount;
    this.surviving += survivingCount;
    this.logger.info({
      module: 'retrieval',
      message: 'retrieval.filtered_recall_shortfall',
      filteredRecallShortfall: shortfall,
      dropRate,
      overThreshold: dropRate > FILTERED_RECALL_SHORTFALL_THRESHOLD,
    });
    return shortfall;
  }

  snapshot(): RetrievalMetricsSnapshot {
    return {
      vectorQueries: this.vectorQueries,
      ftsQueries: this.ftsQueries,
      vectorUnavailable: this.vectorUnavailable,
      ftsUnavailable: this.ftsUnavailable,
      lastEfSearch: this.lastEfSearch,
      lastVectorMs: this.lastVectorMs,
      lastFtsMs: this.lastFtsMs,
      lastRrfMs: this.lastRrfMs,
      lastRerankMs: this.lastRerankMs,
      rerankLlm: this.rerankLlm,
      rerankFallbacks: this.rerankFallbacks,
      filteredRecallShortfall: this.shortfall,
      filteredRecallDropRate: filteredRecallDropRate(this.retrieved, this.surviving),
    };
  }
}
