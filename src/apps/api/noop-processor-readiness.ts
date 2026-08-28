import { Injectable } from '@nestjs/common';
import type { ProcessorReadinessProbe } from '../../platform/config/processor-readiness.port';

@Injectable()
export class NoopProcessorReadiness implements ProcessorReadinessProbe {
  hasProcessors(): boolean {
    return true;
  }
}
