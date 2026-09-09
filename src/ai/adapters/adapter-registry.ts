import { Injectable } from '@nestjs/common';
import type { AiCapability } from '../capability';
import type { CapabilityAdapter } from './adapter.port';

@Injectable()
export class AdapterRegistry {
  private readonly adapters: ReadonlyMap<AiCapability, CapabilityAdapter>;

  constructor(adapters: readonly CapabilityAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.capability, adapter]));
  }

  static forAdapters(adapters: readonly CapabilityAdapter[]): AdapterRegistry {
    return new AdapterRegistry(adapters);
  }

  get(capability: AiCapability): CapabilityAdapter {
    const adapter = this.adapters.get(capability);
    if (adapter === undefined) {
      throw new Error(`No adapter registered for capability ${capability}`);
    }
    return adapter;
  }

  listCapabilities(): readonly AiCapability[] {
    return [...this.adapters.keys()];
  }
}
