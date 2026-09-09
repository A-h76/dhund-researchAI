import type { CacheService } from '../../src/l0/ports/cache.port';

export class MemoryCacheService implements CacheService {
  readonly store = new Map<string, string>();

  async connect(): Promise<void> {
    return;
  }

  async disconnect(): Promise<void> {
    return;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async get(orgId: string, key: string): Promise<string | null> {
    return this.store.get(this.slot(orgId, key)) ?? null;
  }

  async set(orgId: string, key: string, value: string): Promise<void> {
    this.store.set(this.slot(orgId, key), value);
  }

  async del(orgId: string, key: string): Promise<void> {
    this.store.delete(this.slot(orgId, key));
  }

  clear(): void {
    this.store.clear();
  }

  private slot(orgId: string, key: string): string {
    return `${orgId}\0${key}`;
  }
}
