import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { LoggerModule } from '../logging/logger.module';
import { ConsumerIdempotencyService } from './consumer-idempotency.service';
import { EventDispatcherService } from './event-dispatcher.service';
import { OutboxMetrics } from './outbox-metrics';
import { OutboxRelayCoordinationService } from './outbox-relay-coordination.service';
import { OutboxRelaySchedulerService } from './outbox-relay-scheduler.service';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxWriterService } from './outbox-writer.service';
import { RealtimeProjectionPublisher } from './realtime-projection.publisher';

@Module({
  imports: [L0Module, LoggerModule],
  providers: [
    OutboxMetrics,
    OutboxWriterService,
    ConsumerIdempotencyService,
    EventDispatcherService,
    RealtimeProjectionPublisher,
    OutboxRelayCoordinationService,
    OutboxRelayService,
    OutboxRelaySchedulerService,
  ],
  exports: [
    OutboxMetrics,
    OutboxWriterService,
    ConsumerIdempotencyService,
    EventDispatcherService,
    RealtimeProjectionPublisher,
    OutboxRelayCoordinationService,
    OutboxRelayService,
    OutboxRelaySchedulerService,
  ],
})
export class EventsModule {}
