import { Injectable } from '@nestjs/common';

@Injectable()
export class ProcessorRegistry {
  private readonly processors = new Set<string>();

  register(name: string): void {
    if (name.length === 0) {
      throw new Error('Processor name must not be empty');
    }

    this.processors.add(name);
  }

  hasProcessors(): boolean {
    return this.processors.size > 0;
  }

  listProcessors(): readonly string[] {
    return [...this.processors];
  }
}
