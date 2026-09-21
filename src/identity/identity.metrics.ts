import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import type { MergeMatchTypeValue } from '../l0/ports/identity-spine.port';
import { mergeMatchObservabilityLabel } from '../l0/ports/identity-spine.port';

export interface IdentityMetricsSnapshot {
  readonly mergeCandidatesByType: Readonly<Record<string, number>>;
  readonly mergesApproved: number;
  readonly mergesRejected: number;
  readonly resolveLinked: number;
  readonly resolveCreated: number;
}

@Injectable()
export class IdentityMetrics {
  private mergeCandidatesByType: Record<string, number> = {};
  private mergesApproved = 0;
  private mergesRejected = 0;
  private resolveLinked = 0;
  private resolveCreated = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordMergeCandidate(matchType: MergeMatchTypeValue): void {
    const label = mergeMatchObservabilityLabel(matchType);
    this.mergeCandidatesByType[label] = (this.mergeCandidatesByType[label] ?? 0) + 1;
    this.logger.info({
      module: 'identity',
      message: 'identity.merge_candidate',
      matchType: label,
    });
  }

  recordMergeApproved(): void {
    this.mergesApproved += 1;
    this.logger.info({ module: 'identity', message: 'identity.merge.approved' });
  }

  recordMergeRejected(): void {
    this.mergesRejected += 1;
    this.logger.info({ module: 'identity', message: 'identity.merge.rejected' });
  }

  recordResolveLinked(): void {
    this.resolveLinked += 1;
  }

  recordResolveCreated(): void {
    this.resolveCreated += 1;
  }

  snapshot(): IdentityMetricsSnapshot {
    return {
      mergeCandidatesByType: { ...this.mergeCandidatesByType },
      mergesApproved: this.mergesApproved,
      mergesRejected: this.mergesRejected,
      resolveLinked: this.resolveLinked,
      resolveCreated: this.resolveCreated,
    };
  }
}
