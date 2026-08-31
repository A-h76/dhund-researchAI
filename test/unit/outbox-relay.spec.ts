import { OutboxRelayService } from '../../src/platform/events/outbox-relay.service';
import { OutboxRelayCoordinationService } from '../../src/platform/events/outbox-relay-coordination.service';
import { RealtimeProjectionPublisher } from '../../src/platform/events/realtime-projection.publisher';
import { EventDispatcherService } from '../../src/platform/events/event-dispatcher.service';
import { ConsumerIdempotencyService } from '../../src/platform/events/consumer-idempotency.service';
import { OutboxMetrics } from '../../src/platform/events/outbox-metrics';
import type { LeaseService, OutboxPort, OutboxRow, PubSubService } from '../../src/l0/ports';
import type { CacheService } from '../../src/l0/ports';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

describe('outbox relay (DHB-43)', () => {
  const publishedChannels: Array<{ channel: string; message: string }> = [];
  const rows: OutboxRow[] = [];
  const holders = new Map<string, string>();

  const lease: LeaseService = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    tryAcquire: async (_s, key, holderId) => {
      if (holders.has(key) && holders.get(key) !== holderId) {
        return 'contended';
      }
      holders.set(key, holderId);
      return 'acquired';
    },
    renew: async () => true,
    release: async (_s, key, holderId) => {
      if (holders.get(key) === holderId) {
        holders.delete(key);
        return true;
      }
      return false;
    },
    getHolder: async (_s, key) => holders.get(key) ?? null,
  };

  const pubsub: PubSubService = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    publish: async (channel, message) => {
      publishedChannels.push({ channel, message });
    },
  };

  const cacheStore = new Map<string, string>();
  const cache: CacheService = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    get: async (_o, key) => cacheStore.get(key) ?? null,
    set: async (_o, key, value) => {
      cacheStore.set(key, value);
    },
    del: async (_o, key) => {
      cacheStore.delete(key);
    },
  };

  const outbox: OutboxPort = {
    withTransaction: async (work) => work({ __brand: 'OutboxTransaction' }),
    append: async () => undefined,
    appendStateMarker: async () => undefined,
    listUnrelayedOrdered: async (limit) =>
      rows.filter((r) => r.relayedAt === null).slice(0, limit),
    markRelayed: async (id) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        (row as { relayedAt: Date | null }).relayedAt = new Date();
      }
    },
    incrementAttempt: async (id) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        (row as { attemptCount: number }).attemptCount += 1;
      }
    },
    countUnrelayed: async () => rows.filter((r) => r.relayedAt === null).length,
    oldestUnrelayedCreatedAt: async () => {
      const open = rows.filter((r) => r.relayedAt === null);
      return open[0]?.createdAt ?? null;
    },
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  } as unknown as PlatformLogger;

  function buildRelay(): OutboxRelayService {
    const metrics = new OutboxMetrics();
    const idempotency = new ConsumerIdempotencyService(cache, metrics);
    const dispatcher = new EventDispatcherService(idempotency, metrics, logger);
    return new OutboxRelayService(
      outbox,
      new OutboxRelayCoordinationService(lease),
      new RealtimeProjectionPublisher(pubsub),
      dispatcher,
      metrics,
      logger,
    );
  }

  beforeEach(() => {
    rows.length = 0;
    publishedChannels.length = 0;
    holders.clear();
    cacheStore.clear();
  });

  function addRow(partial: Partial<OutboxRow> & Pick<OutboxRow, 'id' | 'aggregateId'>): void {
    const createdAt = partial.createdAt ?? new Date();
    rows.push({
      aggregateType: 'user',
      eventType: 'iam.user.registered',
      schemaVersion: 1,
      payload: {
        envelope: {
          eventId: partial.id,
          eventType: 'iam.user.registered',
          schemaVersion: 1,
          occurredAt: createdAt.toISOString(),
          orgId: 'org-1',
          aggregateType: 'user',
          aggregateId: partial.aggregateId,
          correlationId: 'cor-1',
        },
        data: { orgId: 'org-1', userId: 'u-1', email: 'a@b.co' },
      },
      correlationId: 'cor-1',
      createdAt,
      relayedAt: null,
      attemptCount: 0,
      ...partial,
    });
  }

  it('publishes in per-aggregate insertion order', async () => {
    const agg = '01900000-0000-7000-8000-0000000000aa';
    addRow({ id: 'e1', aggregateId: agg, createdAt: new Date(1_000) });
    addRow({ id: 'e2', aggregateId: agg, createdAt: new Date(2_000) });
    addRow({
      id: 'e3',
      aggregateId: '01900000-0000-7000-8000-0000000000bb',
      createdAt: new Date(1_500),
    });

    const relay = buildRelay();
    await relay.executeTick('tick-1', 'holder-a');

    const order = publishedChannels.map((p) => JSON.parse(p.message).eventId);
    expect(order).toEqual(['e1', 'e2', 'e3']);
  });

  it('leaves unrelayed rows when killed mid-batch for the next tick', async () => {
    const agg = '01900000-0000-7000-8000-0000000000cc';
    addRow({ id: 'e1', aggregateId: agg, createdAt: new Date(1) });
    addRow({ id: 'e2', aggregateId: agg, createdAt: new Date(2) });
    addRow({ id: 'e3', aggregateId: agg, createdAt: new Date(3) });

    const relay = buildRelay();
    relay.setAbortAfterPublished(1);
    const first = await relay.executeTick('tick-crash', 'holder-a');
    expect(first.published).toBe(1);
    expect(rows.filter((r) => r.relayedAt === null).map((r) => r.id)).toEqual(['e2', 'e3']);

    relay.setAbortAfterPublished(null);
    holders.clear();
    const second = await relay.executeTick('tick-resume', 'holder-b');
    expect(second.published).toBe(2);
    expect(rows.every((r) => r.relayedAt !== null)).toBe(true);
  });

  it('no-ops duplicate singleton ticks via lease claim', async () => {
    addRow({
      id: 'e1',
      aggregateId: '01900000-0000-7000-8000-0000000000dd',
      createdAt: new Date(1),
    });
    const relay = buildRelay();
    const first = await relay.executeTick('same-tick', 'holder-a');
    const second = await relay.executeTick('same-tick', 'holder-b');
    expect(first.published).toBe(1);
    expect(second.published).toBe(0);
  });
});
