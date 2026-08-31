import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import Redis from 'ioredis';
import { PrismaDatabaseAdapter } from '../../src/l0/adapters/prisma/prisma-database.adapter';
import { PrismaOutboxAdapter } from '../../src/l0/adapters/prisma/prisma-outbox.adapter';
import { RedisCacheAdapter } from '../../src/l0/adapters/redis/redis-cache.adapter';
import { RedisLeaseAdapter } from '../../src/l0/adapters/redis/redis-lease.adapter';
import { RedisPubSubAdapter } from '../../src/l0/adapters/redis/redis-pubsub.adapter';
import type { L0ConnectionConfig } from '../../src/l0/ports/connection-config.port';
import { generateId } from '../../src/platform/ids/uuid-v7';
import {
  ConsumerIdempotencyService,
  EventDispatcherService,
  OutboxMetrics,
  OutboxRelayCoordinationService,
  OutboxRelayService,
  OutboxWriterService,
  RealtimeProjectionPublisher,
} from '../../src/platform/events';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

(integrationEnabled ? describe : describe.skip)('DHB-43 outbox + relay (integration)', () => {
  jest.setTimeout(360_000);

  let prisma!: PrismaClient;
  let outbox!: PrismaOutboxAdapter;
  let writer!: OutboxWriterService;
  let relay!: OutboxRelayService;
  let dispatcher!: EventDispatcherService;
  let stop: (() => Promise<void>) | undefined;
  let redisUrl!: string;

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  } as unknown as PlatformLogger;

  beforeAll(async () => {
    const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    const databaseUrl = postgres.getConnectionUri();

    const redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();
    redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

    execSync('npx prisma migrate deploy', {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();

    const connectionConfig: L0ConnectionConfig = {
      databaseUrl,
      redisUrl,
      databasePoolSize: 5,
    };

    const database = new PrismaDatabaseAdapter(connectionConfig);
    await database.connect();
    outbox = new PrismaOutboxAdapter(database);
    writer = new OutboxWriterService(outbox);

    const cache = new RedisCacheAdapter(connectionConfig);
    await cache.connect('dhb43');
    const lease = new RedisLeaseAdapter(connectionConfig);
    await lease.connect('dhb43');
    const pubsub = new RedisPubSubAdapter(connectionConfig);
    await pubsub.connect('dhb43');

    const metrics = new OutboxMetrics();
    const idempotency = new ConsumerIdempotencyService(cache, metrics);
    dispatcher = new EventDispatcherService(idempotency, metrics, logger);
    relay = new OutboxRelayService(
      outbox,
      new OutboxRelayCoordinationService(lease),
      new RealtimeProjectionPublisher(pubsub),
      dispatcher,
      metrics,
      logger,
    );

    stop = async () => {
      await cache.disconnect('dhb43');
      await lease.disconnect('dhb43');
      await pubsub.disconnect('dhb43');
      await database.disconnect();
      await prisma.$disconnect();
      await redis.stop();
      await postgres.stop();
    };
  });

  afterAll(async () => {
    if (stop) {
      await stop();
    }
  });

  beforeEach(async () => {
    await prisma.outbox.deleteMany();
    await prisma.auditEvent.deleteMany();
  });

  const baseEvent = (suffix: string) => ({
    eventType: 'iam.user.registered' as const,
    aggregateType: 'user',
    aggregateId: generateId(),
    orgId: 'org-int-1',
    payload: {
      orgId: 'org-int-1',
      userId: `user-${suffix}`,
      email: `${suffix}@example.com`,
    },
  });

  it('commits event and state in the same transaction', async () => {
    await runWithCorrelationIdAsync('cor-commit', async () => {
      await writer.commitWithStateChange(baseEvent('commit'), async ({ markState }) => {
        await markState('user.provisioned', { step: 'create' });
      });
    });

    expect(await prisma.outbox.count()).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(1);
  });

  it('rolling back a state change leaves zero outbox rows', async () => {
    await expect(
      runWithCorrelationIdAsync('cor-rollback', async () => {
        await writer.commitWithStateChange(baseEvent('rollback'), async ({ markState }) => {
          await markState('user.provisioned');
          throw new Error('force-rollback');
        });
      }),
    ).rejects.toBeDefined();

    expect(await prisma.outbox.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it('relay publishes in per-aggregate insertion order', async () => {
    const aggregateId = generateId();
    await runWithCorrelationIdAsync('cor-order', async () => {
      for (const suffix of ['a', 'b', 'c']) {
        await writer.write({
          ...baseEvent(suffix),
          aggregateId,
          eventId: generateId(),
        });
      }
    });

    const result = await relay.executeTick(new Date().toISOString(), 'relay-order');
    expect(result.published).toBe(3);

    const relayed = await prisma.outbox.findMany({
      where: { aggregateId },
      orderBy: { createdAt: 'asc' },
    });
    expect(relayed.every((r) => r.relayedAt !== null)).toBe(true);
    expect(relayed.map((r) => (r.payload as { data: { userId: string } }).data.userId)).toEqual([
      'user-a',
      'user-b',
      'user-c',
    ]);
  });

  it('relay killed mid-batch leaves unrelayed rows for the next tick', async () => {
    const aggregateId = generateId();
    await runWithCorrelationIdAsync('cor-crash', async () => {
      for (let i = 0; i < 3; i += 1) {
        await writer.write({ ...baseEvent(`c${i}`), aggregateId });
      }
    });

    relay.setAbortAfterPublished(1);
    const first = await relay.executeTick('tick-crash', 'relay-a');
    expect(first.published).toBe(1);
    expect(await prisma.outbox.count({ where: { relayedAt: null } })).toBe(2);

    relay.setAbortAfterPublished(null);
    const second = await relay.executeTick('tick-resume', 'relay-b');
    expect(second.published).toBe(2);
    expect(await prisma.outbox.count({ where: { relayedAt: null } })).toBe(0);
  });

  it('duplicate delivery of the same eventId is a no-op for side effects', async () => {
    let sideEffects = 0;
    dispatcher.register('iam.user.registered', () => {
      sideEffects += 1;
    });

    const eventId = generateId();
    await runWithCorrelationIdAsync('cor-dup', async () => {
      await writer.write({ ...baseEvent('dup'), eventId });
    });

    await relay.executeTick('tick-dup-1', 'relay-dup-a');
    // Simulate re-delivery by dispatching the envelope again.
    const row = await prisma.outbox.findFirstOrThrow({ where: { id: eventId } });
    const stored = row.payload as {
      envelope: {
        eventId: string;
        eventType: string;
        schemaVersion: number;
        occurredAt: string;
        orgId: string;
        aggregateType: string;
        aggregateId: string;
        correlationId: string;
      };
      data: Record<string, unknown>;
    };

    const again = await dispatcher.dispatch({
      ...stored.envelope,
      payload: stored.data,
    });

    expect(sideEffects).toBe(1);
    expect(again.status).toBe('duplicate');
  });

  it('publishes advisory projections on Redis pub/sub (non-authoritative)', async () => {
    const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const received: string[] = [];
    await subscriber.subscribe('realtime:projections:org-int-1');
    subscriber.on('message', (_channel, message) => {
      received.push(message);
    });

    await runWithCorrelationIdAsync('cor-pubsub', async () => {
      await writer.write(baseEvent('pubsub'));
    });
    await relay.executeTick('tick-pubsub', 'relay-pubsub');

    await new Promise((r) => setTimeout(r, 200));
    expect(received.length).toBeGreaterThan(0);
    await subscriber.quit();
  });
});
