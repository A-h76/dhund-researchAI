import { BatchConcurrencyGateService } from '../../src/platform/concurrency/batch-concurrency-gate.service';
import { ConcurrencyMetrics } from '../../src/platform/concurrency/concurrency-metrics';
import {
  effectiveGlobalBatchLimit,
  PER_ORG_BATCH_CONCURRENCY_DEFAULT,
} from '../../src/platform/concurrency/concurrency-gate.config';
import type { CounterService } from '../../src/l0/ports';

describe('batch concurrency gate (DHB-42)', () => {
  const counters = new Map<string, number>();

  const counter: CounterService = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    incrementIfBelow: async (key, max) => {
      const current = counters.get(key) ?? 0;
      if (current >= max) {
        return false;
      }
      counters.set(key, current + 1);
      return true;
    },
    decrement: async (key) => {
      const current = counters.get(key) ?? 0;
      const next = Math.max(0, current - 1);
      counters.set(key, next);
      return next;
    },
    get: async (key) => counters.get(key) ?? 0,
  };

  beforeEach(() => {
    counters.clear();
  });

  it('prevents one org from consuming all batch slots', async () => {
    const gate = new BatchConcurrencyGateService(counter, new ConcurrencyMetrics());
    const orgA = 'org-a';
    const orgB = 'org-b';
    const slots = [];

    for (let index = 0; index < PER_ORG_BATCH_CONCURRENCY_DEFAULT; index += 1) {
      const slot = await gate.tryAcquireImmediate(orgA, 'stance');
      expect(slot).not.toBeNull();
      slots.push(slot!);
    }

    expect(await gate.tryAcquireImmediate(orgA, 'stance')).toBeNull();
    expect(await gate.tryAcquireImmediate(orgB, 'stance')).not.toBeNull();

    for (const slot of slots) {
      await gate.release(slot!);
    }
  });

  it('enforces the embed-backfill global cap', async () => {
    const gate = new BatchConcurrencyGateService(counter, new ConcurrencyMetrics());
    const first = await gate.tryAcquireImmediate('org-a', 'embed-backfill');
    const second = await gate.tryAcquireImmediate('org-b', 'embed-backfill');
    const third = await gate.tryAcquireImmediate('org-c', 'embed-backfill');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBeNull();
  });

  it('respects the effective global batch limit minus interactive reserve', async () => {
    const gate = new BatchConcurrencyGateService(counter, new ConcurrencyMetrics());
    const limit = effectiveGlobalBatchLimit();
    const acquired = [];

    for (let index = 0; index < limit; index += 1) {
      const slot = await gate.tryAcquireImmediate(`org-${index}`, 'stance');
      expect(slot).not.toBeNull();
      acquired.push(slot!);
    }

    expect(await gate.tryAcquireImmediate('org-overflow', 'stance')).toBeNull();
  });
});
