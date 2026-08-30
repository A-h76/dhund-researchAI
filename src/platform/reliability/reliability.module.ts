import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { LoggerModule } from '../logging/logger.module';
import { QueuesModule } from '../queues/queues.module';
import { JobHeartbeatService } from './job-heartbeat.service';
import { JobTimeoutService } from './job-timeout.service';
import { LeasedSemaphoreService } from './leased-semaphore.service';
import { ReaperCoordinationService } from './reaper-coordination.service';
import { ReaperSchedulerService } from './reaper-scheduler.service';
import { ReaperService } from './reaper.service';
import { RedisJobLivenessStore } from './redis-job-liveness.store';
import { ReliabilityMetrics } from './reliability-metrics';

@Module({
  imports: [L0Module, LoggerModule, QueuesModule],
  providers: [
    ReliabilityMetrics,
    RedisJobLivenessStore,
    LeasedSemaphoreService,
    JobHeartbeatService,
    JobTimeoutService,
    ReaperCoordinationService,
    ReaperService,
    ReaperSchedulerService,
  ],
  exports: [
    ReliabilityMetrics,
    RedisJobLivenessStore,
    LeasedSemaphoreService,
    JobHeartbeatService,
    JobTimeoutService,
    ReaperCoordinationService,
    ReaperService,
    ReaperSchedulerService,
  ],
})
export class ReliabilityModule {}
