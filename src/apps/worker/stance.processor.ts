import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProcessorRegistry } from './processor-registry';
import { StanceJobConsumer } from './stance-job.consumer';

@Injectable()
export class StanceProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    private readonly consumer: StanceJobConsumer,
  ) {}

  onModuleInit(): void {
    this.processors.register('stance');
    void this.consumer.start();
  }
}
