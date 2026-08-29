import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class PlaceholderProcessor implements OnModuleInit {
  constructor(private readonly registry: ProcessorRegistry) {}

  onModuleInit(): void {
    this.registry.register('health.ping');
  }
}
