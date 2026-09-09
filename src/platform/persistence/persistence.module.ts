import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { LoggerModule } from '../logging/logger.module';
import { ScopedMetrics } from './scoped.metrics';
import { ScopedReader } from './scoped-reader';

@Module({
  imports: [L0Module, LoggerModule],
  providers: [ScopedMetrics, ScopedReader],
  exports: [ScopedMetrics, ScopedReader],
})
export class PersistenceModule {}
