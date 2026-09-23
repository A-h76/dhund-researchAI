const SUBSCRIPTION_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

export interface StripeEventEnvelope {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface SubscriptionSnapshot {
  readonly orgId: string;
  readonly stripeSubscriptionId: string;
  readonly planCode: string;
  readonly status: string;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
}

export function isSubscriptionEvent(type: string): boolean {
  return SUBSCRIPTION_EVENT_TYPES.has(type);
}

export function parseStripeEnvelope(raw: Buffer): StripeEventEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
    return null;
  }
  if (typeof parsed.type !== 'string' || parsed.type.length === 0) {
    return null;
  }
  return { id: parsed.id, type: parsed.type, payload: parsed };
}

/**
 * Org linkage may use metadata.org_id. Plan code comes from the price id
 * (or legacy plan id). Other metadata fields are not entitlement input.
 */
export function readSubscriptionSnapshot(
  payload: Record<string, unknown>,
): SubscriptionSnapshot | null {
  const data = payload.data;
  if (!isRecord(data) || !isRecord(data.object)) {
    return null;
  }
  const object = data.object;
  if (typeof object.id !== 'string' || object.id.length === 0) {
    return null;
  }
  const orgId = readOrgId(object);
  const planCode = readPlanCode(object);
  if (orgId === null || planCode === null) {
    return null;
  }
  const status = typeof object.status === 'string' && object.status.length > 0
    ? object.status
    : 'unknown';
  return {
    orgId,
    stripeSubscriptionId: object.id,
    planCode,
    status,
    periodStart: unixSeconds(object.current_period_start),
    periodEnd: unixSeconds(object.current_period_end),
  };
}

function readOrgId(object: Record<string, unknown>): string | null {
  const metadata = object.metadata;
  if (!isRecord(metadata) || typeof metadata.org_id !== 'string' || metadata.org_id.length === 0) {
    return null;
  }
  return metadata.org_id;
}

function readPlanCode(object: Record<string, unknown>): string | null {
  const items = object.items;
  if (isRecord(items) && Array.isArray(items.data)) {
    const first = items.data[0];
    if (isRecord(first) && isRecord(first.price) && typeof first.price.id === 'string') {
      if (first.price.id.length > 0) {
        return first.price.id;
      }
    }
  }
  if (isRecord(object.plan) && typeof object.plan.id === 'string' && object.plan.id.length > 0) {
    return object.plan.id;
  }
  return null;
}

function unixSeconds(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
