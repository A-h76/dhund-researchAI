export { assertValidEnvelopeShape, FORBIDDEN_ENVELOPE_FIELDS } from './envelope';
export type { EventEnvelope } from './envelope';
export {
  EVENT_CATALOG,
  EVENT_CATALOG_DOMAINS,
  getCatalogEvent,
  getVersionSchema,
  listCatalogEventTypes,
  maxKnownSchemaVersion,
  requireCatalogEvent,
} from './catalog';
export {
  assertCompatibilityWindow,
  findSameVersionBreaks,
  SchemaCompatibilityError,
  validatePayloadAgainstSchema,
} from './schema/compatibility';
export type { CatalogEventDefinition, EventVersionSchema, FieldSchema, FieldType } from './schema/types';
export { field } from './schema/types';
export { OutboxWriterService } from './outbox-writer.service';
export type { WriteOutboxEventInput } from './outbox-writer.service';
export { OutboxRelayService } from './outbox-relay.service';
export type { OutboxRelayTickResult } from './outbox-relay.service';
export { OutboxRelaySchedulerService, floorToInterval } from './outbox-relay-scheduler.service';
export { OutboxRelayCoordinationService } from './outbox-relay-coordination.service';
export { ConsumerIdempotencyService } from './consumer-idempotency.service';
export type { IdempotentConsumeResult } from './consumer-idempotency.service';
export { EventDispatcherService } from './event-dispatcher.service';
export type { EventConsumeOutcome, EventHandler } from './event-dispatcher.service';
export { RealtimeProjectionPublisher } from './realtime-projection.publisher';
export { REALTIME_PROJECTION_CHANNEL_PREFIX, realtimeChannelForOrg } from './realtime-channels';
export { OutboxMetrics } from './outbox-metrics';
export type { OutboxMetricsSnapshot } from './outbox-metrics';
export {
  OUTBOX_RELAY_BATCH_SIZE,
  OUTBOX_RELAY_LEASE_TTL_SECONDS,
  OUTBOX_RELAY_TICK_INTERVAL_MS,
  PLATFORM_EVENTS_SCOPE,
} from './outbox-relay.config';
export { EventsModule } from './events.module';
