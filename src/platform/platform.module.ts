import { Module } from '@nestjs/common';
import { L0Module } from '../l0/l0.module';
import { BootstrapModule } from './config/bootstrap.module';
import { ConcurrencyModule } from './concurrency/concurrency.module';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './logging/logger.module';
import { QueuesModule } from './queues/queues.module';
import { ReliabilityModule } from './reliability/reliability.module';

@Module({
  imports: [
    ConfigModule,
    L0Module,
    LoggerModule,
    BootstrapModule,
    QueuesModule,
    ReliabilityModule,
    ConcurrencyModule,
  ],
  exports: [
    ConfigModule,
    L0Module,
    LoggerModule,
    BootstrapModule,
    QueuesModule,
    ReliabilityModule,
    ConcurrencyModule,
  ],
})
export class PlatformModule {}
