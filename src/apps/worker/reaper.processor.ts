import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProcessorRegistry } from './processor-registry';
import { ReaperSchedulerService } from '../../platform/reliability';

@Injectable()
export class ReaperProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    private readonly scheduler: ReaperSchedulerService,
  ) {}

  onModuleInit(): void {
    this.processors.register('reaper');
    this.scheduler.start();
  }
}
