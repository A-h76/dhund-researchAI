import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { LoggerModule } from '../logging/logger.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DlqReplayService } from './dlq-replay.service';
import { DlqService } from './dlq.service';
import { QueueMetricsService } from './queue-metrics';
import { QueueObservationRegistrar } from './queue-observation.registrar';

@Module({
  imports: [L0Module, LoggerModule, ObservabilityModule],
  providers: [DlqService, DlqReplayService, QueueMetricsService, QueueObservationRegistrar],
  exports: [DlqService, DlqReplayService, QueueMetricsService],
})
export class QueuesModule {}
