import type { OutboxInsertInput } from './outbox.port';
import type { ResearchRunCoverage } from './research-run-coverage';
import type {
  ResearchRunFailedReason,
  ResearchRunStateName,
} from './research-run-state';
import type { ResearchStepStateName } from './research-run-step-state';

/**
 * L0 persistence for ResearchRun version-guarded transitions (DHB-64)
 * and research_run_steps (DHB-65).
 * Advisory lock is a contention optimisation (GAP-COORD-LOCK-01); the version
 * guard alone preserves correctness.
 */

export const RESEARCH_RUN_PRESETS = [
  'deep_research',
  'extraction_matrix',
  'chat',
  'custom',
] as const;

export type ResearchRunPresetName = (typeof RESEARCH_RUN_PRESETS)[number];

export function isResearchRunPreset(value: string): value is ResearchRunPresetName {
  return (RESEARCH_RUN_PRESETS as readonly string[]).includes(value);
}

export interface ResearchRunRecord {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly preset: ResearchRunPresetName;
  readonly customDag: unknown | null;
  readonly state: ResearchRunStateName;
  readonly version: number;
  readonly reservedMicros: bigint;
  readonly consumedMicros: bigint;
  readonly coverage: ResearchRunCoverage;
  readonly startedAt: Date | null;
  readonly terminalAt: Date | null;
}

export interface ResearchRunStepRecord {
  readonly id: string;
  readonly runId: string;
  readonly stepType: string;
  readonly dependsOnStepIds: readonly string[];
  readonly inputFingerprint: string;
  readonly stepVersion: string;
  readonly state: ResearchStepStateName;
  readonly attemptCount: number;
  readonly resultRef: string | null;
  readonly version: number;
}

export interface ResearchRunStepSeed {
  readonly id: string;
  readonly stepType: string;
  readonly dependsOnStepIds: readonly string[];
  readonly inputFingerprint: string;
  readonly stepVersion: string;
  readonly state: ResearchStepStateName;
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

export interface ResearchRunStepTransitionInput {
  readonly stepId: string;
  readonly fromState: ResearchStepStateName;
  readonly toState: ResearchStepStateName;
  readonly expectedVersion: number;
  readonly resultRef?: string | null;
  readonly inputFingerprint?: string;
  readonly incrementAttempt?: boolean;
  readonly outboxEvents?: readonly OutboxInsertInput[];
}

export type ResearchRunStepTransitionResult =
  | { readonly kind: 'applied'; readonly step: ResearchRunStepRecord }
  | { readonly kind: 'version_conflict'; readonly step: ResearchRunStepRecord }
  | { readonly kind: 'not_found' };

export interface ResearchRunStore {
  getById(runId: string): Promise<ResearchRunRecord | null>;
  countSteps(runId: string): Promise<ResearchRunStepCounts>;
  listSteps(runId: string): Promise<readonly ResearchRunStepRecord[]>;
  getStep(stepId: string): Promise<ResearchRunStepRecord | null>;
  createSteps(runId: string, steps: readonly ResearchRunStepSeed[]): Promise<void>;
  transitionStep(
    input: ResearchRunStepTransitionInput,
  ): Promise<ResearchRunStepTransitionResult>;
  /**
   * Conditional update `WHERE id AND state AND version`, bump version, append
   * outbox rows in the same transaction. Returns version_conflict when the
   * guard misses — never double-applies.
   */
  transition(input: ResearchRunTransitionInput): Promise<ResearchRunTransitionResult>;
}
