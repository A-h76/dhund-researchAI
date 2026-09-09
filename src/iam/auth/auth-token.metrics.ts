import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging';

export interface AuthTokenMetricsSnapshot {
  readonly issued: number;
  readonly consumed: number;
  readonly expired: number;
  readonly rejected: number;
}

const ORACLE_METRIC_KEYS = [
  'email_exists',
  'user_not_found',
  'existing_user',
  'unknown_email',
] as const;

@Injectable()
export class AuthTokenMetrics {
  private issued = 0;
  private consumed = 0;
  private expired = 0;
  private rejected = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordIssued(): void {
    this.issued += 1;
    this.logger.info({
      module: 'iam',
      message: 'auth_token.issued',
    });
  }

  recordConsumed(): void {
    this.consumed += 1;
    this.logger.info({
      module: 'iam',
      message: 'auth_token.consumed',
    });
  }

  recordExpired(): void {
    this.expired += 1;
    this.logger.info({
      module: 'iam',
      message: 'auth_token.expired',
    });
  }

  recordRejected(): void {
    this.rejected += 1;
    this.logger.info({
      module: 'iam',
      message: 'auth_token.rejected',
    });
  }

  snapshot(): AuthTokenMetricsSnapshot {
    return {
      issued: this.issued,
      consumed: this.consumed,
      expired: this.expired,
      rejected: this.rejected,
    };
  }

  hasOracleKeys(): boolean {
    const keys = Object.keys(this.snapshot());
    return ORACLE_METRIC_KEYS.some((key) => keys.includes(key));
  }
}
