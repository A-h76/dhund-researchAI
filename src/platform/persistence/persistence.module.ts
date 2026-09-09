import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { LoggerModule } from '../logging/logger.module';
import { DeletionMetrics } from './deletion.metrics';
import { ProjectErasureService } from './project-erasure.service';
import { ScopedMetrics } from './scoped.metrics';
import { ScopedReader } from './scoped-reader';

@Module({
  imports: [L0Module, LoggerModule],
  providers: [ScopedMetrics, ScopedReader, DeletionMetrics, ProjectErasureService],
  exports: [ScopedMetrics, ScopedReader, DeletionMetrics, ProjectErasureService],
})
export class PersistenceModule {}
