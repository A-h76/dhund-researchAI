import { Injectable, OnModuleInit } from '@nestjs/common';
import { registerQueryObservability } from '../../l0/observability-bridge';
import { MetricsSurface } from './metrics-surface';

@Injectable()
export class SlowQueryMetricsRegistrar implements OnModuleInit {
  constructor(private readonly metrics: MetricsSurface) {}

  onModuleInit(): void {
    registerQueryObservability({
      onSlowQuery: (event) => {
        this.metrics.recordSlowQuery(event.durationMs);
      },
    });
  }
}
