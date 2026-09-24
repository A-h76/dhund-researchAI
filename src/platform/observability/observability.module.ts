import { Global, Module } from '@nestjs/common';
import { LoggerModule } from '../logging/logger.module';
import { AlertingService } from './alerting.service';
import { MetricsSurface } from './metrics-surface';
import { SlowQueryMetricsRegistrar } from './slow-query.registrar';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [AlertingService, MetricsSurface, SlowQueryMetricsRegistrar],
  exports: [AlertingService, MetricsSurface],
})
export class ObservabilityModule {}
