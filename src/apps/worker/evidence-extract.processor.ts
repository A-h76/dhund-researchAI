import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProcessorRegistry } from './processor-registry';

/**
 * DHB-59 inventory marker. `research-run-step` is consumed by
 * ResearchRunStepProcessor, which routes evidence-extract jobs.
 */
@Injectable()
export class EvidenceExtractProcessor implements OnModuleInit {
  constructor(private readonly processors: ProcessorRegistry) {}

  onModuleInit(): void {
    this.processors.register('research-run-step');
  }
}
