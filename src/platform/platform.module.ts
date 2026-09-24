import { Module } from '@nestjs/common';
import { L0Module } from '../l0/l0.module';
import { BootstrapModule } from './config/bootstrap.module';
import { ConcurrencyModule } from './concurrency/concurrency.module';
import { ConfigModule } from './config/config.module';
import { EventsModule } from './events/events.module';
import { LoggerModule } from './logging/logger.module';
import { PersistenceModule } from './persistence/persistence.module';
import { ObservabilityModule } from './observability/observability.module';
import { QueuesModule } from './queues/queues.module';
import { ReliabilityModule } from './reliability/reliability.module';

@Module({
  imports: [
    ConfigModule,
    L0Module,
    LoggerModule,
    ObservabilityModule,
    BootstrapModule,
    QueuesModule,
    ReliabilityModule,
    ConcurrencyModule,
    EventsModule,
    PersistenceModule,
  ],
  exports: [
    ConfigModule,
    L0Module,
    LoggerModule,
    ObservabilityModule,
    BootstrapModule,
    QueuesModule,
    ReliabilityModule,
    ConcurrencyModule,
    EventsModule,
    PersistenceModule,
  ],
})
export class PlatformModule {}
