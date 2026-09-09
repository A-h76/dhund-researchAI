import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging';

export interface RegistrationMetricsSnapshot {
  readonly success: number;
  readonly validationFailure: number;
  readonly failure: number;
  readonly breachListDegraded: number;
}

const ORACLE_METRIC_KEYS = [
  'email_exists',
  'email_taken',
  'existing_user',
  'duplicate_email',
] as const;

@Injectable()
export class RegistrationMetrics {
  private success = 0;
  private validationFailure = 0;
  private failure = 0;
  private breachListDegraded = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordSuccess(): void {
    this.success += 1;
    this.logger.info({
      module: 'iam',
      message: 'registration.success',
    });
  }

  recordValidationFailure(): void {
    this.validationFailure += 1;
    this.logger.info({
      module: 'iam',
      message: 'registration.validation_failure',
    });
  }

  recordFailure(): void {
    this.failure += 1;
    this.logger.info({
      module: 'iam',
      message: 'registration.failure',
    });
  }

  recordBreachListDegraded(): void {
    this.breachListDegraded += 1;
  }

  snapshot(): RegistrationMetricsSnapshot {
    return {
      success: this.success,
      validationFailure: this.validationFailure,
      failure: this.failure,
      breachListDegraded: this.breachListDegraded,
    };
  }

  hasOracleKeys(): boolean {
    const keys = Object.keys(this.snapshot());
    return ORACLE_METRIC_KEYS.some((key) => keys.includes(key));
  }
}
