import type { CounterService } from '../../src/l0/ports';

export class MemoryCounterService implements CounterService {
  readonly counts = new Map<string, number>();
  maxAllowed: number | null = null;

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  incrementIfBelow(key: string, max: number, _ttlSeconds: number): Promise<boolean> {
    const current = this.counts.get(key) ?? 0;
    const ceiling = this.maxAllowed ?? max;
    if (current >= ceiling) {
      return Promise.resolve(false);
    }
    this.counts.set(key, current + 1);
    return Promise.resolve(true);
  }

  decrement(key: string): Promise<number> {
    const next = Math.max(0, (this.counts.get(key) ?? 0) - 1);
    this.counts.set(key, next);
    return Promise.resolve(next);
  }

  get(key: string): Promise<number> {
    return Promise.resolve(this.counts.get(key) ?? 0);
  }
}
