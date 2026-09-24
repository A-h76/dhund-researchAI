import { Injectable, Optional } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging';
import { MetricsSurface } from '../platform/observability/metrics-surface';

export type ChunkFailureCause =
  | 'version_missing'
  | 'no_blocks'
  | 'commit'
  | 'forbidden_transition';

export interface ChunkMetricsSnapshot {
  readonly chunksCreated: number;
  readonly chunksPerHour: number;
  readonly documentsChunked: number;
  readonly chunksPerDocument: readonly number[];
  readonly reuseHits: number;
  readonly reuseRate: number;
  readonly completed: number;
  readonly partial: number;
  readonly staleChunksDetected: number;
  readonly failures: Readonly<Record<ChunkFailureCause, number>>;
}

@Injectable()
export class ChunkMetrics {
  private chunksCreated = 0;
  private durationMs = 0;
  private documentsChunked = 0;
  private readonly chunksPerDocument: number[] = [];
  private reuseHits = 0;
  private reuseCandidates = 0;
  private completed = 0;
  private partial = 0;
  private staleChunksDetected = 0;
  private readonly failures: Record<ChunkFailureCause, number> = {
    version_missing: 0,
    no_blocks: 0,
    commit: 0,
    forbidden_transition: 0,
  };

  constructor(
    private readonly logger: PlatformLogger,
    @Optional() private readonly surface?: MetricsSurface,
  ) {}

  recordSuccess(input: {
    readonly chunkCount: number;
    readonly createdCount: number;
    readonly reusedCount: number;
    readonly durationMs: number;
    readonly partial: boolean;
    readonly staleDetected: number;
  }): void {
    this.chunksCreated += input.createdCount;
    this.surface?.recordIngestion('chunk', input.createdCount);
    this.durationMs += input.durationMs;
    this.documentsChunked += 1;
    this.chunksPerDocument.push(input.chunkCount);
    this.reuseHits += input.reusedCount;
    this.reuseCandidates += input.chunkCount;
    this.staleChunksDetected += input.staleDetected;
    if (input.partial) {
      this.partial += 1;
    } else {
      this.completed += 1;
    }
    this.logger.info({
      module: 'ingestion.chunk',
      message: 'chunk.completed',
      chunkCount: input.chunkCount,
      createdCount: input.createdCount,
      reusedCount: input.reusedCount,
      durationMs: input.durationMs,
      partial: input.partial,
      staleDetected: input.staleDetected,
    });
  }

  recordFailure(cause: ChunkFailureCause): void {
    this.failures[cause] += 1;
    this.logger.warn({
      module: 'ingestion.chunk',
      message: 'chunk.failed',
      cause,
    });
  }

  snapshot(): ChunkMetricsSnapshot {
    const hours = this.durationMs / 3_600_000;
    return {
      chunksCreated: this.chunksCreated,
      chunksPerHour: hours > 0 ? this.chunksCreated / hours : 0,
      documentsChunked: this.documentsChunked,
      chunksPerDocument: [...this.chunksPerDocument],
      reuseHits: this.reuseHits,
      reuseRate: this.reuseCandidates > 0 ? this.reuseHits / this.reuseCandidates : 0,
      completed: this.completed,
      partial: this.partial,
      staleChunksDetected: this.staleChunksDetected,
      failures: { ...this.failures },
    };
  }
}
