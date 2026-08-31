export interface OutboxMetricsSnapshot {
  readonly outboxDepth: number;
  readonly relayLagMs: number | null;
  readonly eventsPublishedByType: Readonly<Record<string, number>>;
  readonly unknownFutureVersionCount: number;
  readonly duplicateDeliveryCount: number;
}

export class OutboxMetrics {
  private outboxDepth = 0;
  private relayLagMs: number | null = null;
  private readonly eventsPublishedByType = new Map<string, number>();
  private unknownFutureVersionCount = 0;
  private duplicateDeliveryCount = 0;

  recordDepth(depth: number): void {
    this.outboxDepth = depth;
  }

  recordRelayLag(lagMs: number | null): void {
    this.relayLagMs = lagMs;
  }

  recordPublished(eventType: string): void {
    this.eventsPublishedByType.set(
      eventType,
      (this.eventsPublishedByType.get(eventType) ?? 0) + 1,
    );
  }

  recordUnknownFutureVersion(): void {
    this.unknownFutureVersionCount += 1;
  }

  recordDuplicateDelivery(): void {
    this.duplicateDeliveryCount += 1;
  }

  snapshot(): OutboxMetricsSnapshot {
    return {
      outboxDepth: this.outboxDepth,
      relayLagMs: this.relayLagMs,
      eventsPublishedByType: Object.fromEntries(this.eventsPublishedByType),
      unknownFutureVersionCount: this.unknownFutureVersionCount,
      duplicateDeliveryCount: this.duplicateDeliveryCount,
    };
  }

  reset(): void {
    this.outboxDepth = 0;
    this.relayLagMs = null;
    this.eventsPublishedByType.clear();
    this.unknownFutureVersionCount = 0;
    this.duplicateDeliveryCount = 0;
  }
}
