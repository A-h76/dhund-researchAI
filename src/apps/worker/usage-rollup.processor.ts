import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class UsageRollupProcessor implements OnModuleInit {
  constructor(private readonly processors: ProcessorRegistry) {}

  onModuleInit(): void {
    this.processors.register('usage-rollup');
  }
}
