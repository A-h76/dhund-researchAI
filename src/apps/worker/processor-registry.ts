import { Injectable } from '@nestjs/common';
import {
  hasR1Processor,
  QUEUE_NAMES,
  R1_FORWARD_COMPAT_QUEUES,
  type QueueName,
} from '../../platform/queues';

@Injectable()
export class ProcessorRegistry {
  private readonly processors = new Set<string>();

  register(name: string): void {
    if (name.length === 0) {
      throw new Error('Processor name must not be empty');
    }

    if ((R1_FORWARD_COMPAT_QUEUES as readonly string[]).includes(name)) {
      throw new Error(`Queue "${name}" must not register an R1 processor`);
    }

    this.processors.add(name);
  }

  hasProcessors(): boolean {
    return this.processors.size > 0;
  }

  listProcessors(): readonly string[] {
    return [...this.processors];
  }

  listR1EligibleQueues(): readonly QueueName[] {
    return QUEUE_NAMES.filter((name) => hasR1Processor(name));
  }
}
