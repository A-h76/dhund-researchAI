import { Injectable } from '@nestjs/common';
import { ProcessorRegistry } from './processor-registry';

@Injectable()
export class WorkerBootstrapService {
  constructor(private readonly processors: ProcessorRegistry) {}

  hasRegisteredProcessors(): boolean {
    return this.processors.hasProcessors();
  }
}
