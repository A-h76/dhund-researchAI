import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../logging';
import { LARGE_RECLAIM_ORPHAN_COUNT } from './orphan-sweep.constants';

export interface OrphanSweepMetricsSnapshot {
  readonly bytesReclaimed: number;
  readonly orphanCount: number;
  readonly durationMs: number;
  readonly aborted: number;
  readonly completed: number;
}

@Injectable()
export class OrphanSweepMetrics {
  private bytesReclaimed = 0;
  private orphanCount = 0;
  private durationMs = 0;
  private aborted = 0;
  private completed = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordCompleted(input: {
    readonly bytesReclaimed: number;
    readonly orphanCount: number;
    readonly durationMs: number;
  }): void {
    this.bytesReclaimed += input.bytesReclaimed;
    this.orphanCount += input.orphanCount;
    this.durationMs += input.durationMs;
    this.completed += 1;
    this.logger.info({
      module: 'ingestion',
      message: 'orphan.sweep.completed',
      bytesReclaimed: input.bytesReclaimed,
      orphanCount: input.orphanCount,
      durationMs: input.durationMs,
    });
    if (input.orphanCount >= LARGE_RECLAIM_ORPHAN_COUNT) {
      this.logger.warn({
        module: 'ingestion',
        message: 'orphan.sweep.large_reclaim',
        orphanCount: input.orphanCount,
        bytesReclaimed: input.bytesReclaimed,
      });
    }
  }

  recordAbort(reason: 'ownership_incomplete' | 'list_failed'): void {
    this.aborted += 1;
    this.logger.warn({
      module: 'ingestion',
      message: 'orphan.sweep.aborted',
      reason,
    });
  }

  snapshot(): OrphanSweepMetricsSnapshot {
    return {
      bytesReclaimed: this.bytesReclaimed,
      orphanCount: this.orphanCount,
      durationMs: this.durationMs,
      aborted: this.aborted,
      completed: this.completed,
    };
  }
}
