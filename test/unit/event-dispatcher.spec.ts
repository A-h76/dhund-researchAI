import { EventDispatcherService } from '../../src/platform/events/event-dispatcher.service';
import { ConsumerIdempotencyService } from '../../src/platform/events/consumer-idempotency.service';
import { OutboxMetrics } from '../../src/platform/events/outbox-metrics';
import type { EventEnvelope } from '../../src/platform/events/envelope';
import type { CacheService } from '../../src/l0/ports';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

describe('event dispatcher (DHB-43)', () => {
  const cacheStore = new Map<string, string>();
  const cache: CacheService = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    get: async (_org, key) => cacheStore.get(key) ?? null,
    set: async (_org, key, value) => {
      cacheStore.set(key, value);
    },
    del: async (_org, key) => {
      cacheStore.delete(key);
    },
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  } as unknown as PlatformLogger;

  beforeEach(() => {
    cacheStore.clear();
  });

  function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
    return {
      eventId: '01900000-0000-7000-8000-000000000001',
      eventType: 'iam.user.registered',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      orgId: 'org-1',
      aggregateType: 'user',
      aggregateId: '01900000-0000-7000-8000-000000000002',
      correlationId: 'cor-1',
      payload: { orgId: 'org-1', userId: 'u-1', email: 'a@b.co' },
      ...overrides,
    };
  }

  function buildDispatcher(): EventDispatcherService {
    const metrics = new OutboxMetrics();
    const idempotency = new ConsumerIdempotencyService(cache, metrics);
    return new EventDispatcherService(idempotency, metrics, logger);
  }

  it('does not apply a second side effect for duplicate eventId', async () => {
    const dispatcher = buildDispatcher();
    let calls = 0;
    dispatcher.register('iam.user.registered', () => {
      calls += 1;
    });

    const first = await dispatcher.dispatch(envelope());
    const second = await dispatcher.dispatch(envelope());

    expect(first.status).toBe('processed');
    expect(second.status).toBe('duplicate');
    expect(calls).toBe(1);
  });

  it('neither crashes nor silently drops an unknown future schemaVersion', async () => {
    const dispatcher = buildDispatcher();
    let calls = 0;
    dispatcher.register('iam.user.registered', () => {
      calls += 1;
    });

    const outcome = await dispatcher.dispatch(envelope({ schemaVersion: 99 }));

    expect(outcome.status).toBe('unknown_future_version');
    if (outcome.status === 'unknown_future_version') {
      expect(outcome.schemaVersion).toBe(99);
      expect(outcome.maxKnown).toBe(1);
    }
    expect(calls).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});
