import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxRelaySchedulerService } from '../../platform/events';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class OutboxRelayProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    private readonly scheduler: OutboxRelaySchedulerService,
  ) {}

  onModuleInit(): void {
    this.processors.register('outbox-relay');
    this.scheduler.start();
  }
}
