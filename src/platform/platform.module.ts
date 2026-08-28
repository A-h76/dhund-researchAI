import { Module } from '@nestjs/common';
import { L0Module } from '../l0/l0.module';
import { LoggerModule } from './logging/logger.module';

@Module({
  imports: [L0Module, LoggerModule],
  exports: [L0Module, LoggerModule],
})
export class PlatformModule {}
