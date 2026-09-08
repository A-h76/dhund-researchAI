import { Injectable } from '@nestjs/common';
import type { BoundaryRefusalReason } from './boundary-reasons';

export interface BoundaryMetricsSnapshot {
  readonly rejectionsByReason: Readonly<Record<string, number>>;
}

@Injectable()
export class BoundaryMetrics {
  private readonly rejectionsByReason = new Map<BoundaryRefusalReason, number>();

  recordRejection(reason: BoundaryRefusalReason): void {
    this.rejectionsByReason.set(reason, (this.rejectionsByReason.get(reason) ?? 0) + 1);
  }

  snapshot(): BoundaryMetricsSnapshot {
    return {
      rejectionsByReason: Object.fromEntries(this.rejectionsByReason),
    };
  }

  reset(): void {
    this.rejectionsByReason.clear();
  }
}
