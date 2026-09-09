import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../logging';

export interface ScopedMetricsSnapshot {
  readonly notFound: number;
}

@Injectable()
export class ScopedMetrics {
  private notFound = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordNotFound(): void {
    this.notFound += 1;
    this.logger.info({
      module: 'platform',
      message: 'scoped.not_found',
    });
  }

  snapshot(): ScopedMetricsSnapshot {
    return { notFound: this.notFound };
  }
}
