import { Injectable } from '@nestjs/common';
import type { AiCapability } from '../capability';
import type { CapabilityAdapter } from './adapter.port';
import { STUB_ADAPTERS } from './stub/stub-adapters';

@Injectable()
export class AdapterRegistry {
  private readonly adapters: ReadonlyMap<AiCapability, CapabilityAdapter>;

  constructor() {
    this.adapters = new Map(
      STUB_ADAPTERS.map((adapter) => [adapter.capability, adapter]),
    );
  }

  /** Test-only: construct an isolated registry with custom adapters. */
  static forAdapters(adapters: readonly CapabilityAdapter[]): AdapterRegistry {
    const registry = Object.create(AdapterRegistry.prototype) as AdapterRegistry;
    Object.defineProperty(registry, 'adapters', {
      value: new Map(adapters.map((adapter) => [adapter.capability, adapter])),
      writable: false,
    });
    return registry;
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
