import { Injectable, OnModuleInit } from '@nestjs/common';
import { ExtractJobConsumer } from '../../ingestion/extract/extract-job.consumer';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class ExtractProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    private readonly consumer: ExtractJobConsumer,
  ) {}

  onModuleInit(): void {
    this.processors.register('extract');
    void this.consumer.start();
  }
}
