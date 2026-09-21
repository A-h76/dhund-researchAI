import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging/platform-logger.service';

export interface ExternalRecordMetricsSnapshot {
  readonly snapshotRefreshes: number;
  readonly snapshotNoops: number;
  readonly refreshFailures: number;
  readonly staleMarked: number;
  readonly rightsRejections: number;
}

@Injectable()
export class ExternalRecordMetrics {
  private snapshotRefreshes = 0;
  private snapshotNoops = 0;
  private refreshFailures = 0;
  private staleMarked = 0;
  private rightsRejections = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordSnapshotRefresh(): void {
    this.snapshotRefreshes += 1;
    this.logger.info({
      module: 'external_records',
      message: 'external_record.snapshot.refresh',
    });
  }

  recordSnapshotNoop(): void {
    this.snapshotNoops += 1;
    this.logger.info({
      module: 'external_records',
      message: 'external_record.snapshot.noop',
    });
  }

  recordRefreshFailure(): void {
    this.refreshFailures += 1;
    this.logger.warn({
      module: 'external_records',
      message: 'external_record.refresh.failed',
    });
  }

  recordStale(): void {
    this.staleMarked += 1;
    this.logger.warn({
      module: 'external_records',
      message: 'external_record.stale',
    });
  }

  recordRightsRejection(): void {
    this.rightsRejections += 1;
    this.logger.warn({
      module: 'external_records',
      message: 'external_record.rights.rejected',
    });
  }

  snapshot(): ExternalRecordMetricsSnapshot {
    return {
      snapshotRefreshes: this.snapshotRefreshes,
      snapshotNoops: this.snapshotNoops,
      refreshFailures: this.refreshFailures,
      staleMarked: this.staleMarked,
      rightsRejections: this.rightsRejections,
    };
  }
}

/** Payload fingerprint for unchanged-refresh detection (R10). */
export function snapshotPayloadHash(
  metadata: Readonly<Record<string, unknown>>,
  contentRef: string | null,
): string {
  const body = JSON.stringify({ metadata, contentRef });
  return createHash('sha256').update(body).digest('hex');
}
