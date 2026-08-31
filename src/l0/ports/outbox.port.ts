export interface OutboxInsertInput {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
  readonly correlationId: string;
}

export interface OutboxRow {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly relayedAt: Date | null;
  readonly attemptCount: number;
}

/** Opaque transactional handle — same TX as any co-committed state change. */
export type OutboxTransaction = {
  readonly __brand: 'OutboxTransaction';
};

export interface OutboxPort {
  withTransaction<T>(work: (tx: OutboxTransaction) => Promise<T>): Promise<T>;
  append(tx: OutboxTransaction, input: OutboxInsertInput): Promise<void>;
  /** Co-commit a stand-in state row (audit_events) with an outbox event — for atomicity tests. */
  appendStateMarker(tx: OutboxTransaction, input: {
    id: string;
    action: string;
    correlationId: string;
    scope: Record<string, unknown>;
  }): Promise<void>;
  listUnrelayedOrdered(limit: number): Promise<readonly OutboxRow[]>;
  markRelayed(id: string, relayedAt?: Date): Promise<void>;
  incrementAttempt(id: string): Promise<void>;
  countUnrelayed(): Promise<number>;
  oldestUnrelayedCreatedAt(): Promise<Date | null>;
}
