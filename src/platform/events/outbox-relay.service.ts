import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_SERVICE, type OutboxPort, type OutboxRow } from '../../l0/ports';
import { runWithCorrelationIdAsync } from '../logging/correlation-context';
import { PlatformLogger } from '../logging/platform-logger.service';
import type { EventEnvelope } from './envelope';
import { EventDispatcherService } from './event-dispatcher.service';
import { OutboxMetrics } from './outbox-metrics';
import { OutboxRelayCoordinationService } from './outbox-relay-coordination.service';
import { OUTBOX_RELAY_BATCH_SIZE } from './outbox-relay.config';
import { RealtimeProjectionPublisher } from './realtime-projection.publisher';

export interface OutboxRelayTickResult {
  readonly tickBucket: string;
  readonly published: number;
  readonly skipped: number;
  readonly parkedUnknownVersion: number;
}

@Injectable()
export class OutboxRelayService {
  /** When true, stop before marking further rows — simulates mid-batch crash. */
  private abortAfterPublished: number | null = null;

  constructor(
    @Inject(OUTBOX_SERVICE) private readonly outbox: OutboxPort,
    private readonly coordination: OutboxRelayCoordinationService,
    private readonly projections: RealtimeProjectionPublisher,
    private readonly dispatcher: EventDispatcherService,
    private readonly metrics: OutboxMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  /** Test hook — crash simulation after N successful publishes (before mark). */
  setAbortAfterPublished(count: number | null): void {
    this.abortAfterPublished = count;
  }

  async executeTick(
    tickBucket: string,
    holderId: string,
    batchSize: number = OUTBOX_RELAY_BATCH_SIZE,
  ): Promise<OutboxRelayTickResult> {
    const claim = await this.coordination.tryClaimTick(tickBucket, holderId);
    if (claim === 'noop') {
      return { tickBucket, published: 0, skipped: 0, parkedUnknownVersion: 0 };
    }

    const rows = await this.outbox.listUnrelayedOrdered(batchSize);
    let published = 0;
    let skipped = 0;
    let parkedUnknownVersion = 0;

    for (const row of rows) {
      if (this.abortAfterPublished !== null && published >= this.abortAfterPublished) {
        break;
      }

      await this.outbox.incrementAttempt(row.id);
      const envelope = this.rowToEnvelope(row);

      if (this.abortAfterPublished !== null && published >= this.abortAfterPublished) {
        break;
      }

      await runWithCorrelationIdAsync(envelope.correlationId, async () => {
        const outcome = await this.dispatcher.dispatch(envelope);

        if (outcome.status === 'unknown_future_version') {
          parkedUnknownVersion += 1;
          skipped += 1;
          return;
        }

        if (outcome.status === 'invalid_payload' || outcome.status === 'unknown_event_type') {
          this.logger.warn({
            module: 'events',
            message: 'outbox.relay.row_skipped',
            eventId: row.id,
            eventType: row.eventType,
            reason: outcome.status,
          });
          skipped += 1;
        }

        await this.projections.publishAdvisory(envelope);
        await this.outbox.markRelayed(row.id);
        this.metrics.recordPublished(row.eventType);
        published += 1;
      });
    }

    const depth = await this.outbox.countUnrelayed();
    this.metrics.recordDepth(depth);
    const oldest = await this.outbox.oldestUnrelayedCreatedAt();
    this.metrics.recordRelayLag(oldest === null ? null : Date.now() - oldest.getTime());

    this.logger.info({
      module: 'events',
      message: 'outbox.relay.tick.completed',
      tickBucket,
      published,
      skipped,
      parkedUnknownVersion,
      depth,
    });

    return { tickBucket, published, skipped, parkedUnknownVersion };
  }

  private rowToEnvelope(row: OutboxRow): EventEnvelope {
    const stored = row.payload as {
      envelope?: Partial<EventEnvelope>;
      data?: Record<string, unknown>;
    };

    if (stored?.envelope !== undefined && stored.data !== undefined) {
      const env = stored.envelope;
      return {
        eventId: env.eventId ?? row.id,
        eventType: env.eventType ?? row.eventType,
        schemaVersion: env.schemaVersion ?? row.schemaVersion,
        occurredAt: env.occurredAt ?? row.createdAt.toISOString(),
        orgId: env.orgId ?? String((stored.data as { orgId?: string }).orgId ?? 'unknown'),
        ...(env.projectId !== undefined ? { projectId: env.projectId } : {}),
        aggregateType: env.aggregateType ?? row.aggregateType,
        aggregateId: env.aggregateId ?? row.aggregateId,
        correlationId: env.correlationId ?? row.correlationId,
        payload: stored.data,
      };
    }

    return {
      eventId: row.id,
      eventType: row.eventType,
      schemaVersion: row.schemaVersion,
      occurredAt: row.createdAt.toISOString(),
      orgId: String((row.payload as { orgId?: string })?.orgId ?? 'unknown'),
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      correlationId: row.correlationId,
      payload: (row.payload as Record<string, unknown>) ?? {},
    };
  }
}
