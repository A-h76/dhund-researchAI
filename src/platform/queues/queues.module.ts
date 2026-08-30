import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { LoggerModule } from '../logging/logger.module';
import { DlqReplayService } from './dlq-replay.service';
import { DlqService } from './dlq.service';
import { QueueMetricsService } from './queue-metrics';

@Module({
  imports: [L0Module, LoggerModule],
  providers: [DlqService, DlqReplayService, QueueMetricsService],
  exports: [DlqService, DlqReplayService, QueueMetricsService],
})
export class QueuesModule {}
