import { Injectable, OnModuleInit } from '@nestjs/common';
import { OrphanSweepSchedulerService } from '../../platform/persistence/orphan-sweep.scheduler';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class OrphanSweepProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    private readonly scheduler: OrphanSweepSchedulerService,
  ) {}

  onModuleInit(): void {
    this.processors.register('orphan-sweep');
    this.scheduler.start();
  }
}
