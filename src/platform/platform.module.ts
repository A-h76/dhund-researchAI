import { Module } from '@nestjs/common';
import { L0Module } from '../l0/l0.module';
import { BootstrapModule } from './config/bootstrap.module';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './logging/logger.module';
import { QueuesModule } from './queues/queues.module';
import { ReliabilityModule } from './reliability/reliability.module';

@Module({
  imports: [ConfigModule, L0Module, LoggerModule, BootstrapModule, QueuesModule, ReliabilityModule],
  exports: [ConfigModule, L0Module, LoggerModule, BootstrapModule, QueuesModule, ReliabilityModule],
})
export class PlatformModule {}
