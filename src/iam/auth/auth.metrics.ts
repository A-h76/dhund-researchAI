import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging';

export interface AuthMetricsSnapshot {
  readonly loginSuccess: number;
  readonly loginFailure: number;
  readonly refreshRotation: number;
  readonly refreshFamilyRevoked: number;
}

const ORACLE_METRIC_KEYS = [
  'email_exists',
  'user_not_found',
  'wrong_password',
  'existing_user',
] as const;

@Injectable()
export class AuthMetrics {
  private loginSuccess = 0;
  private loginFailure = 0;
  private refreshRotation = 0;
  private refreshFamilyRevoked = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordLoginSuccess(): void {
    this.loginSuccess += 1;
    this.logger.info({
      module: 'iam',
      message: 'login.success',
    });
  }

  recordLoginFailure(): void {
    this.loginFailure += 1;
    this.logger.info({
      module: 'iam',
      message: 'login.failure',
    });
  }

  recordRefreshRotation(): void {
    this.refreshRotation += 1;
    this.logger.info({
      module: 'iam',
      message: 'refresh.rotation',
    });
  }

  recordFamilyRevoked(fields: {
    readonly familyId: string;
    readonly sessionId: string;
    readonly reason: string;
  }): void {
    this.refreshFamilyRevoked += 1;
    this.logger.warn({
      module: 'iam',
      message: 'refresh.family_revoked',
      familyId: fields.familyId,
      sessionId: fields.sessionId,
      reason: fields.reason,
    });
  }

  snapshot(): AuthMetricsSnapshot {
    return {
      loginSuccess: this.loginSuccess,
      loginFailure: this.loginFailure,
      refreshRotation: this.refreshRotation,
      refreshFamilyRevoked: this.refreshFamilyRevoked,
    };
  }

  hasOracleKeys(): boolean {
    const keys = Object.keys(this.snapshot());
    return ORACLE_METRIC_KEYS.some((key) => keys.includes(key));
  }
}
