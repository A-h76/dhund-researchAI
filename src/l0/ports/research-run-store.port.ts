import type { OutboxInsertInput } from './outbox.port';
import type { ResearchRunCoverage } from './research-run-coverage';
import type {
  ResearchRunFailedReason,
  ResearchRunStateName,
} from './research-run-state';

/**
 * L0 persistence for ResearchRun version-guarded transitions (DHB-64).
 * Advisory lock is a contention optimisation (GAP-COORD-LOCK-01); the version
 * guard alone preserves correctness.
 */

export interface ResearchRunRecord {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly state: ResearchRunStateName;
  readonly version: number;
  readonly reservedMicros: bigint;
  readonly consumedMicros: bigint;
  readonly coverage: ResearchRunCoverage;
  readonly startedAt: Date | null;
  readonly terminalAt: Date | null;
}

export interface ResearchRunStepCounts {
  readonly ready: number;
  readonly inFlight: number;
  readonly pending: number;
  readonly deferred: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
}

export type ResearchRunTransitionResult =
  | {
      readonly kind: 'applied';
      readonly run: ResearchRunRecord;
      readonly outboxEventIds: readonly string[];
    }
  | {
      readonly kind: 'version_conflict';
      readonly run: ResearchRunRecord;
    };

export interface ResearchRunTransitionInput {
  readonly runId: string;
  readonly fromState: ResearchRunStateName;
  readonly toState: ResearchRunStateName;
  readonly expectedVersion: number;
  readonly outboxEvents: readonly OutboxInsertInput[];
  readonly coverage?: ResearchRunCoverage;
  readonly failedReason?: ResearchRunFailedReason;
  /** When true, acquire pg_advisory_xact_lock inside the transition TX. */
  readonly useAdvisoryLock: boolean;
  /** When transitioning to CANCELLED, also cancel non-terminal steps in the same TX. */
  readonly cancelSteps?: boolean;
}

export interface ResearchRunStore {
  getById(runId: string): Promise<ResearchRunRecord | null>;
  countSteps(runId: string): Promise<ResearchRunStepCounts>;
  /**
   * Conditional update `WHERE id AND state AND version`, bump version, append
   * outbox rows in the same transaction. Returns version_conflict when the
   * guard misses — never double-applies.
   */
  transition(input: ResearchRunTransitionInput): Promise<ResearchRunTransitionResult>;
}
