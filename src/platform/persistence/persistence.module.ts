import { Module } from '@nestjs/common';
import { L0Module } from '../../l0/l0.module';
import { LoggerModule } from '../logging/logger.module';
import { DeletionMetrics } from './deletion.metrics';
import { OrphanSweepMetrics } from './orphan-sweep.metrics';
import { OrphanSweepSchedulerService } from './orphan-sweep.scheduler';
import { OrphanSweepService } from './orphan-sweep.service';
import { ProjectErasureService } from './project-erasure.service';
import { ScopedMetrics } from './scoped.metrics';
import { ScopedReader } from './scoped-reader';

@Module({
  imports: [L0Module, LoggerModule],
  providers: [
    ScopedMetrics,
    ScopedReader,
    DeletionMetrics,
    ProjectErasureService,
    OrphanSweepMetrics,
    OrphanSweepService,
    OrphanSweepSchedulerService,
  ],
  exports: [
    ScopedMetrics,
    ScopedReader,
    DeletionMetrics,
    ProjectErasureService,
    OrphanSweepMetrics,
    OrphanSweepService,
    OrphanSweepSchedulerService,
  ],
})
export class PersistenceModule {}
