import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../logging';

export interface DeletionJobSnapshot {
  readonly bytesShredded: number;
  readonly orphansRemoved: number;
  readonly actorsAnonymised: number;
  readonly failures: number;
  readonly jobsCompleted: number;
}

@Injectable()
export class DeletionMetrics {
  private bytesShredded = 0;
  private orphansRemoved = 0;
  private actorsAnonymised = 0;
  private failures = 0;
  private jobsCompleted = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordJob(input: {
    readonly bytesShredded: number;
    readonly orphansRemoved: number;
    readonly actorsAnonymised: number;
    readonly erasureComplete: boolean;
  }): void {
    this.bytesShredded += input.bytesShredded;
    this.orphansRemoved += input.orphansRemoved;
    this.actorsAnonymised += input.actorsAnonymised;
    this.jobsCompleted += 1;
    this.logger.info({
      module: 'platform',
      message: 'deletion.metrics',
      bytesShredded: input.bytesShredded,
      orphansRemoved: input.orphansRemoved,
      actorsAnonymised: input.actorsAnonymised,
      erasureComplete: input.erasureComplete,
    });
  }

  recordFailure(): void {
    this.failures += 1;
    this.logger.warn({
      module: 'platform',
      message: 'deletion.job.failure',
    });
  }

  snapshot(): DeletionJobSnapshot {
    return {
      bytesShredded: this.bytesShredded,
      orphansRemoved: this.orphansRemoved,
      actorsAnonymised: this.actorsAnonymised,
      failures: this.failures,
      jobsCompleted: this.jobsCompleted,
    };
  }
}
