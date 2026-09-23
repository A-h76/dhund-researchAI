import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BILLING_STORE,
  LEASE_SERVICE,
  QUEUE_SERVICE,
  SECRETS_SERVICE,
  type LeaseAcquireResult,
  type LeaseService,
  type QueueService,
} from '../../src/l0/ports';
import { orgRoleAtLeast } from '../../src/platform/authorization/roles';
import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode, httpStatusFor } from '../../src/platform/errors/error-codes';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import type { PlatformLogger } from '../../src/platform/logging/platform-logger.service';
import { BillingMetrics } from '../../src/billing/billing.metrics';
import { BillingReconcileCoordination } from '../../src/billing/billing-reconcile.coordination';
import { BillingReconcileService } from '../../src/billing/billing-reconcile.service';
import { BillingSyncService } from '../../src/billing/billing-sync.service';
import { deriveEntitlement } from '../../src/billing/entitlement';
import { admitQuota } from '../../src/billing/quota';
import { readSubscriptionSnapshot } from '../../src/billing/stripe-event';
import { signStripePayload } from '../../src/billing/stripe-signature';
import { StripeWebhookController } from '../../src/billing/stripe-webhook.controller';
import {
  StripeWebhookService,
  WEBHOOK_MAX_BODY_BYTES,
} from '../../src/billing/stripe-webhook.service';
import { UsageRollupService } from '../../src/billing/usage-rollup.service';
import {
  isCalendarMonthPeriod,
  MISSING_STRIPE_PERIOD_KEY,
  usagePeriodFromStripe,
} from '../../src/billing/usage-period';
import { MemoryBillingStore } from '../fixtures/memory-billing-store';

const SECRET = 'whsec_test';
const ORG_ID = 'org-dhb73';

function subscriptionPayload(input: {
  id: string;
  planCode: string;
  periodStart: number | null;
  periodEnd: number | null;
  metadataPlan?: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_dhb73',
        status: 'active',
        metadata: {
          org_id: ORG_ID,
          ...(input.metadataPlan !== undefined ? { plan: input.metadataPlan } : {}),
        },
        items: { data: [{ price: { id: input.planCode } }] },
        ...(input.periodStart !== null ? { current_period_start: input.periodStart } : {}),
        ...(input.periodEnd !== null ? { current_period_end: input.periodEnd } : {}),
      },
    },
  };
}

function signedBody(payload: Record<string, unknown>, nowMs: number): {
  raw: Buffer;
  signature: string;
} {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    raw,
    signature: signStripePayload(SECRET, raw, Math.floor(nowMs / 1000)),
  };
}

function queueMock(): QueueService & { jobs: Array<{ queue: string; data: Record<string, unknown> }> } {
  const jobs: Array<{ queue: string; data: Record<string, unknown> }> = [];
  return {
    jobs,
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    addJob: async (queue, data) => {
      jobs.push({ queue, data });
      return 'job-1';
    },
    addDlqJob: async () => 'dlq-1',
    getJobState: async () => null,
    retryFailedJob: async () => 'noop',
    getQueueDepth: async () => ({ waiting: 0, active: 0, failed: 0, delayed: 0 }),
    consume: async () => undefined,
  };
}

function sharedLease(): LeaseService {
  const held = new Map<string, string>();
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    ping: async () => true,
    tryAcquire: async (scope, key, holderId): Promise<LeaseAcquireResult> => {
      const id = `${scope}:${key}`;
      const current = held.get(id);
      if (current === undefined) {
        held.set(id, holderId);
        return 'acquired';
      }
      return current === holderId ? 'renewed' : 'contended';
    },
    renew: async () => true,
    release: async () => true,
    getHolder: async (scope, key) => held.get(`${scope}:${key}`) ?? null,
  };
}

describe('DHB-73 billing', () => {
  const nowMs = Date.parse('2026-09-23T08:00:00.000Z');
  const periodStart = Math.floor(Date.parse('2026-09-01T00:00:00.000Z') / 1000);
  const periodEnd = Math.floor(Date.parse('2026-10-01T00:00:00.000Z') / 1000);

  it('rejects an invalid webhook signature with 400 and does not persist it', async () => {
    const store = new MemoryBillingStore();
    const queue = queueMock();
    const webhooks = new StripeWebhookService(
      store,
      queue,
      { getSecret: () => SECRET, listSecretKeys: () => ['STRIPE_WEBHOOK_SECRET'] },
      new BillingMetrics(),
    );
    const body = signedBody(subscriptionPayload({
      id: 'evt_bad',
      planCode: 'price_x',
      periodStart,
      periodEnd,
    }), nowMs);

    await expect(
      webhooks.receive({
        rawBody: body.raw,
        signature: 't=1,v1=deadbeef',
        nowMs,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.MalformedRequest });
    expect(httpStatusFor(ErrorCode.MalformedRequest)).toBe(400);
    expect(store.events.size).toBe(0);
    expect(queue.jobs).toEqual([]);
  });

  it('accepts a signed event once and short-circuits a duplicate id with 200', async () => {
    const store = new MemoryBillingStore();
    const queue = queueMock();
    const metrics = new BillingMetrics();
    const webhooks = new StripeWebhookService(
      store,
      queue,
      { getSecret: () => SECRET, listSecretKeys: () => ['STRIPE_WEBHOOK_SECRET'] },
      metrics,
    );
    const body = signedBody(subscriptionPayload({
      id: 'evt_1',
      planCode: 'price_x',
      periodStart,
      periodEnd,
    }), nowMs);

    await expect(
      webhooks.receive({ rawBody: body.raw, signature: body.signature, nowMs }),
    ).resolves.toEqual({ outcome: 'accepted' });
    await expect(
      webhooks.receive({ rawBody: body.raw, signature: body.signature, nowMs }),
    ).resolves.toEqual({ outcome: 'duplicate' });

    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.queue).toBe('billing-sync');
    expect(metrics.snapshot().duplicateShortCircuits).toBe(1);
    expect(httpStatusFor(ErrorCode.MalformedRequest)).toBe(400);
  });

  it('rejects an oversized body before persistence', async () => {
    const store = new MemoryBillingStore();
    const webhooks = new StripeWebhookService(
      store,
      queueMock(),
      { getSecret: () => SECRET, listSecretKeys: () => [] },
      new BillingMetrics(),
    );
    const rawBody = Buffer.alloc(WEBHOOK_MAX_BODY_BYTES + 1, 0x61);
    await expect(webhooks.receive({ rawBody, signature: 't=1,v1=aa', nowMs })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(webhooks.receive({ rawBody, signature: 't=1,v1=aa', nowMs })).rejects.toMatchObject({
      code: ErrorCode.FileTooLarge,
    });
    expect(httpStatusFor(ErrorCode.FileTooLarge)).toBe(413);
    expect(store.events.size).toBe(0);
  });

  it('rejects malformed JSON after a valid signature without inserting', async () => {
    const store = new MemoryBillingStore();
    const rawBody = Buffer.from('{', 'utf8');
    const webhooks = new StripeWebhookService(
      store,
      queueMock(),
      { getSecret: () => SECRET, listSecretKeys: () => [] },
      new BillingMetrics(),
    );
    await expect(
      webhooks.receive({
        rawBody,
        signature: signStripePayload(SECRET, rawBody, Math.floor(nowMs / 1000)),
        nowMs,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.MalformedRequest });
    expect(store.events.size).toBe(0);
  });

  it('derives a restrictive entitlement for an unknown plan and ignores Stripe metadata', () => {
    const entitlement = deriveEntitlement('price_unknown');
    expect(entitlement).toEqual({ kind: 'restrictive', planCode: 'price_unknown' });
    expect(Object.keys(entitlement).sort()).toEqual(['kind', 'planCode']);
    expect(admitQuota('price_unknown')).toEqual({ outcome: 'restrictive', entitlement });
    const snapshot = readSubscriptionSnapshot(subscriptionPayload({
      id: 'evt_meta',
      planCode: 'price_from_item',
      periodStart,
      periodEnd,
      metadataPlan: 'ignored-tier',
    }));
    expect(snapshot?.planCode).toBe('price_from_item');
  });

  it('keeps usage on the Stripe period and does not reset it when the plan changes', async () => {
    const store = new MemoryBillingStore();
    const metrics = new BillingMetrics();
    const sync = new BillingSyncService(store, metrics);
    const rollup = new UsageRollupService(store, queueMock(), metrics);
    const created = subscriptionPayload({
      id: 'evt_created',
      planCode: 'price_a',
      periodStart,
      periodEnd,
    });
    await store.insertStripeEvent({ id: 'evt_created', type: 'customer.subscription.updated', payload: created });
    await sync.handle('evt_created');

    const start = new Date(periodStart * 1000);
    const end = new Date(periodEnd * 1000);
    const period = usagePeriodFromStripe(start, end);
    expect(isCalendarMonthPeriod(period.period)).toBe(false);
    expect(period.source).toBe('stripe');

    await rollup.apply({
      orgId: ORG_ID,
      metric: 'documents',
      value: 7n,
      periodStart: start,
      periodEnd: end,
    });
    await rollup.apply({
      orgId: ORG_ID,
      metric: 'documents',
      value: 7n,
      periodStart: start,
      periodEnd: end,
    });

    const changed = subscriptionPayload({
      id: 'evt_changed',
      planCode: 'price_b',
      periodStart,
      periodEnd,
    });
    await store.insertStripeEvent({
      id: 'evt_changed',
      type: 'customer.subscription.updated',
      payload: changed,
    });
    await sync.handle('evt_changed');

    const usage = await store.findUsage(ORG_ID, period.period, 'documents');
    expect(usage?.value).toBe(7n);
    expect(store.usage.size).toBe(1);
    expect((await store.findSubscriptionByOrg(ORG_ID))?.planCode).toBe('price_b');
  });

  it('uses the documented fallback period and refuses to zero existing usage', async () => {
    const store = new MemoryBillingStore();
    const rollup = new UsageRollupService(store, queueMock(), new BillingMetrics());
    const missing = usagePeriodFromStripe(null, null);
    expect(missing.period).toBe(MISSING_STRIPE_PERIOD_KEY);
    expect(missing.source).toBe('fallback');
    expect(isCalendarMonthPeriod(missing.period)).toBe(false);

    await rollup.apply({
      orgId: ORG_ID,
      metric: 'ai_tokens',
      value: 12n,
      periodStart: null,
      periodEnd: null,
    });
    await rollup.apply({
      orgId: ORG_ID,
      metric: 'ai_tokens',
      value: 0n,
      periodStart: null,
      periodEnd: null,
    });
    const usage = await store.findUsage(ORG_ID, MISSING_STRIPE_PERIOD_KEY, 'ai_tokens');
    expect(usage?.value).toBe(12n);
  });

  it('claims billing reconcile once per tick across workers', async () => {
    const lease = sharedLease();
    const store = new MemoryBillingStore();
    const first = new BillingReconcileService(
      new BillingReconcileCoordination(lease),
      store,
      new BillingMetrics(),
    );
    const second = new BillingReconcileService(
      new BillingReconcileCoordination(lease),
      store,
      new BillingMetrics(),
    );
    await expect(first.executeTick('2026-09-23', 'worker-a')).resolves.toBe('claimed');
    await expect(second.executeTick('2026-09-23', 'worker-b')).resolves.toBe('noop');
  });

  it('keeps BILLING off the data-role ladder', () => {
    expect(orgRoleAtLeast('BILLING', 'MEMBER')).toBe(false);
  });
});

describe('DHB-73 webhook HTTP', () => {
  const nowMs = Date.parse('2026-09-23T08:00:00.000Z');
  let app: INestApplication;
  let baseUrl: string;
  let store: MemoryBillingStore;

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    store = new MemoryBillingStore();
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as PlatformLogger;
    const moduleRef = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        StripeWebhookService,
        BillingMetrics,
        { provide: BILLING_STORE, useValue: store },
        { provide: QUEUE_SERVICE, useValue: queueMock() },
        {
          provide: SECRETS_SERVICE,
          useValue: { getSecret: () => SECRET, listSecretKeys: () => ['STRIPE_WEBHOOK_SECRET'] },
        },
        { provide: LEASE_SERVICE, useValue: sharedLease() },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useLogger(false);
    app.useGlobalFilters(new GlobalExceptionFilter(logger));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('returns 400 for a bad signature and 200 for a signed event', async () => {
    const payload = subscriptionPayload({
      id: 'evt_http',
      planCode: 'price_http',
      periodStart: Math.floor(Date.parse('2026-09-01T00:00:00.000Z') / 1000),
      periodEnd: Math.floor(Date.parse('2026-10-01T00:00:00.000Z') / 1000),
    });
    const body = JSON.stringify(payload);
    const bad = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      body,
    });
    expect(bad.status).toBe(400);
    expect(store.events.size).toBe(0);

    const good = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(SECRET, Buffer.from(body, 'utf8'), Math.floor(nowMs / 1000)),
      },
      body,
    });
    expect(good.status).toBe(200);
    expect(store.events.has('evt_http')).toBe(true);
  });
});
