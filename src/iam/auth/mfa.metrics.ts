import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging';

export interface MfaMetricsSnapshot {
  readonly challenge: number;
  readonly success: number;
  readonly failure: number;
  readonly recoveryRedeemed: number;
}

@Injectable()
export class MfaMetrics {
  private challenge = 0;
  private success = 0;
  private failure = 0;
  private recoveryRedeemed = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordChallenge(): void {
    this.challenge += 1;
    this.logger.info({
      module: 'iam',
      message: 'mfa.challenge',
    });
  }

  recordSuccess(): void {
    this.success += 1;
    this.logger.info({
      module: 'iam',
      message: 'mfa.success',
    });
  }

  recordFailure(): void {
    this.failure += 1;
    this.logger.info({
      module: 'iam',
      message: 'mfa.failure',
    });
  }

  recordRecoveryRedeemed(): void {
    this.recoveryRedeemed += 1;
    this.logger.info({
      module: 'iam',
      message: 'mfa.recovery_redeemed',
    });
  }

  snapshot(): MfaMetricsSnapshot {
    return {
      challenge: this.challenge,
      success: this.success,
      failure: this.failure,
      recoveryRedeemed: this.recoveryRedeemed,
    };
  }
}
