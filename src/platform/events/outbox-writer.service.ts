import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_SERVICE, type OutboxPort } from '../../l0/ports';
import { generateId } from '../ids/uuid-v7';
import { requireCorrelationId } from '../logging/correlation-context';
import { requireCatalogEvent } from './catalog';
import {
  assertValidEnvelopeShape,
  type EventEnvelope,
} from './envelope';
import { validatePayloadAgainstSchema } from './schema/compatibility';

export interface WriteOutboxEventInput {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly orgId: string;
  readonly projectId?: string;
  readonly payload: Record<string, unknown>;
  readonly schemaVersion?: number;
  readonly eventId?: string;
  readonly occurredAt?: string;
  readonly correlationId?: string;
}

@Injectable()
export class OutboxWriterService {
  constructor(@Inject(OUTBOX_SERVICE) private readonly outbox: OutboxPort) {}

  /**
   * Append an event inside an existing outbox transaction (same TX as state change).
   * Rolling back the transaction leaves zero outbox rows.
   */
  async appendInTransaction(
    tx: Parameters<OutboxPort['append']>[0],
    input: WriteOutboxEventInput,
  ): Promise<EventEnvelope> {
    const envelope = this.buildEnvelope(input);
    await this.outbox.append(tx, {
      id: envelope.eventId,
      aggregateType: envelope.aggregateType,
      aggregateId: envelope.aggregateId,
      eventType: envelope.eventType,
      schemaVersion: envelope.schemaVersion,
      payload: this.toStoredPayload(envelope),
      correlationId: envelope.correlationId,
    });
    return envelope;
  }

  /** Own short transaction — prefer appendInTransaction when co-committing state. */
  async write(input: WriteOutboxEventInput): Promise<EventEnvelope> {
    let envelope!: EventEnvelope;
    await this.outbox.withTransaction(async (tx) => {
      envelope = await this.appendInTransaction(tx, input);
    });
    return envelope;
  }

  /**
   * Commit event + state marker in ONE transaction.
   * If stateChange throws, both the marker and the outbox row roll back.
   */
  async commitWithStateChange(
    input: WriteOutboxEventInput,
    stateChange: (helpers: {
      markState: (action: string, scope?: Record<string, unknown>) => Promise<void>;
    }) => Promise<void>,
  ): Promise<EventEnvelope> {
    let envelope!: EventEnvelope;
    await this.outbox.withTransaction(async (tx) => {
      envelope = await this.appendInTransaction(tx, input);
      await stateChange({
        markState: async (action, scope = {}) => {
          await this.outbox.appendStateMarker(tx, {
            id: generateId(),
            action,
            correlationId: envelope.correlationId,
            scope: { orgId: envelope.orgId, ...scope },
          });
        },
      });
    });
    return envelope;
  }

  private buildEnvelope(input: WriteOutboxEventInput): EventEnvelope {
    const catalog = requireCatalogEvent(input.eventType);
    const schemaVersion = input.schemaVersion ?? catalog.currentVersion;
    const versionSchema = catalog.versions.find((v) => v.schemaVersion === schemaVersion);
    if (versionSchema === undefined) {
      throw new Error(
        `schemaVersion ${schemaVersion} is not in the compatibility window for ${input.eventType}`,
      );
    }

    validatePayloadAgainstSchema(input.payload, versionSchema);

    const correlationId = input.correlationId ?? requireCorrelationId();
    const envelope: EventEnvelope = {
      eventId: input.eventId ?? generateId(),
      eventType: input.eventType,
      schemaVersion,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      orgId: input.orgId,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      correlationId,
      payload: input.payload,
    };

    assertValidEnvelopeShape(envelope);
    return envelope;
  }

  private toStoredPayload(envelope: EventEnvelope): Record<string, unknown> {
    return {
      envelope: {
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        schemaVersion: envelope.schemaVersion,
        occurredAt: envelope.occurredAt,
        orgId: envelope.orgId,
        ...(envelope.projectId !== undefined ? { projectId: envelope.projectId } : {}),
        aggregateType: envelope.aggregateType,
        aggregateId: envelope.aggregateId,
        correlationId: envelope.correlationId,
      },
      data: envelope.payload,
    };
  }
}
