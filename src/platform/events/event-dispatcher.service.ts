import { Injectable } from '@nestjs/common';
import { getCatalogEvent, getVersionSchema, maxKnownSchemaVersion } from './catalog';
import type { EventEnvelope } from './envelope';
import { OutboxMetrics } from './outbox-metrics';
import { validatePayloadAgainstSchema } from './schema/compatibility';
import { ConsumerIdempotencyService } from './consumer-idempotency.service';
import { PlatformLogger } from '../logging/platform-logger.service';

export type EventConsumeOutcome =
  | { readonly status: 'processed' }
  | { readonly status: 'duplicate' }
  | {
      readonly status: 'unknown_future_version';
      readonly schemaVersion: number;
      readonly maxKnown: number;
    }
  | { readonly status: 'unknown_event_type' }
  | { readonly status: 'invalid_payload'; readonly message: string };

export type EventHandler = (envelope: EventEnvelope) => Promise<void> | void;

/**
 * Dispatches envelopes to handlers with GAP-EVENT-VER-01 semantics:
 * unknown future schemaVersion must not crash and must not be silently dropped.
 */
@Injectable()
export class EventDispatcherService {
  private readonly handlers = new Map<string, EventHandler>();

  constructor(
    private readonly idempotency: ConsumerIdempotencyService,
    private readonly metrics: OutboxMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  register(eventType: string, handler: EventHandler): void {
    this.handlers.set(eventType, handler);
  }

  async dispatch(envelope: EventEnvelope): Promise<EventConsumeOutcome> {
    const catalog = getCatalogEvent(envelope.eventType);
    if (catalog === undefined) {
      this.logger.warn({
        module: 'events',
        message: 'events.unknown_type',
        eventType: envelope.eventType,
        eventId: envelope.eventId,
      });
      return { status: 'unknown_event_type' };
    }

    const maxKnown = maxKnownSchemaVersion(envelope.eventType) ?? catalog.currentVersion;
    if (envelope.schemaVersion > maxKnown) {
      this.metrics.recordUnknownFutureVersion();
      this.logger.warn({
        module: 'events',
        message: 'events.unknown_future_schema_version',
        eventType: envelope.eventType,
        eventId: envelope.eventId,
        schemaVersion: envelope.schemaVersion,
        maxKnown,
      });
      // Do not crash; do not silently drop — caller must park / retry.
      return {
        status: 'unknown_future_version',
        schemaVersion: envelope.schemaVersion,
        maxKnown,
      };
    }

    const versionSchema = getVersionSchema(envelope.eventType, envelope.schemaVersion);
    if (versionSchema === undefined) {
      return {
        status: 'invalid_payload',
        message: `No schema for ${envelope.eventType}@${envelope.schemaVersion}`,
      };
    }

    try {
      validatePayloadAgainstSchema(envelope.payload, versionSchema);
    } catch (error) {
      return {
        status: 'invalid_payload',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const handler = this.handlers.get(envelope.eventType);
    if (handler === undefined) {
      // No local handler — still acknowledge schema validation succeeded.
      return { status: 'processed' };
    }

    const result = await this.idempotency.runOnce(envelope.eventId, () => handler(envelope));
    return result === 'duplicate' ? { status: 'duplicate' } : { status: 'processed' };
  }
}
