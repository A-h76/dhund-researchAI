import { Injectable, Optional } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging';
import { MetricsSurface } from '../platform/observability/metrics-surface';

export type UploadRejectionClass =
  | 'invalid_file_type'
  | 'invalid_filename'
  | 'file_too_large'
  | 'magic_bytes_mismatch'
  | 'upload_not_completed'
  | 'session_expired'
  | 'concurrency_limit'
  | 'storage_unavailable'
  | 'invalid_state_transition'
  | 'idempotency_key_reused'
  | 'idempotency_key_required';

export interface UploadsMetricsSnapshot {
  readonly created: number;
  readonly completed: number;
  readonly expired: number;
  readonly rejected: number;
}

@Injectable()
export class UploadsMetrics {
  private created = 0;
  private completed = 0;
  private expired = 0;
  private rejected = 0;

  constructor(
    private readonly logger: PlatformLogger,
    @Optional() private readonly surface?: MetricsSurface,
  ) {}

  recordCreated(): void {
    this.created += 1;
    this.logger.info({
      module: 'ingestion',
      message: 'upload.session.created',
    });
  }

  recordCompleted(): void {
    this.completed += 1;
    this.surface?.recordIngestion('upload', 1);
    this.logger.info({
      module: 'ingestion',
      message: 'upload.session.completed',
    });
  }

  recordExpired(): void {
    this.expired += 1;
    this.logger.info({
      module: 'ingestion',
      message: 'upload.session.expired',
    });
  }

  recordRejected(reason: UploadRejectionClass): void {
    this.rejected += 1;
    this.logger.info({
      module: 'ingestion',
      message: 'upload.session.rejected',
      reason,
    });
  }

  snapshot(): UploadsMetricsSnapshot {
    return {
      created: this.created,
      completed: this.completed,
      expired: this.expired,
      rejected: this.rejected,
    };
  }
}
