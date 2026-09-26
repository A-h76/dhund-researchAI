import { Injectable, OnModuleInit } from '@nestjs/common';
import { EvidenceExtractJobConsumer } from './evidence-extract-job.consumer';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class EvidenceExtractProcessor implements OnModuleInit {
  constructor(
    private readonly processors: ProcessorRegistry,
    private readonly consumer: EvidenceExtractJobConsumer,
  ) {}

  onModuleInit(): void {
    this.processors.register('research-run-step');
    void this.consumer.start();
  }
}
