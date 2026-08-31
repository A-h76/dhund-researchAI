/**
 * Phase 5 §3 event envelope.
 * Only correlationId — no causationId, no separate traceId in v1.
 */
export interface EventEnvelope<TPayload = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly occurredAt: string;
  readonly orgId: string;
  readonly projectId?: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly payload: TPayload;
}

export const FORBIDDEN_ENVELOPE_FIELDS = ['causationId', 'traceId'] as const;

export function assertValidEnvelopeShape(envelope: EventEnvelope): void {
  for (const forbidden of FORBIDDEN_ENVELOPE_FIELDS) {
    if (forbidden in envelope) {
      throw new Error(`Event envelope must not include ${forbidden} in v1`);
    }
  }

  if (typeof envelope.eventId !== 'string' || envelope.eventId.length === 0) {
    throw new Error('eventId is required');
  }
  if (typeof envelope.eventType !== 'string' || envelope.eventType.length === 0) {
    throw new Error('eventType is required');
  }
  if (!Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion < 1) {
    throw new Error('schemaVersion must be an integer >= 1 (GAP-EVENT-VER-01)');
  }
  if (typeof envelope.correlationId !== 'string' || envelope.correlationId.length === 0) {
    throw new Error('correlationId is required');
  }
  if (typeof envelope.orgId !== 'string' || envelope.orgId.length === 0) {
    throw new Error('orgId is required');
  }
  if (typeof envelope.aggregateType !== 'string' || envelope.aggregateType.length === 0) {
    throw new Error('aggregateType is required');
  }
  if (typeof envelope.aggregateId !== 'string' || envelope.aggregateId.length === 0) {
    throw new Error('aggregateId is required');
  }
  if (typeof envelope.occurredAt !== 'string' || envelope.occurredAt.length === 0) {
    throw new Error('occurredAt is required');
  }
  if (typeof envelope.payload !== 'object' || envelope.payload === null || Array.isArray(envelope.payload)) {
    throw new Error('payload must be an object');
  }
}
