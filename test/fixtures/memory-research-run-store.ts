import {
  emptyResearchRunCoverage,
  type ResearchRunCoverage,
} from '../../src/l0/ports/research-run-coverage';
import {
  canTransitionResearchRun,
  isResearchRunTerminal,
  ResearchRunTransitionError,
  type ResearchRunFailedReason,
  type ResearchRunStateName,
} from '../../src/l0/ports/research-run-state';
import type {
  ResearchRunRecord,
  ResearchRunStepCounts,
  ResearchRunStore,
  ResearchRunTransitionInput,
  ResearchRunTransitionResult,
} from '../../src/l0/ports/research-run-store.port';

export interface MemoryResearchRunSeed {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly state?: ResearchRunStateName;
  readonly version?: number;
  readonly reservedMicros?: bigint;
  readonly consumedMicros?: bigint;
  readonly coverage?: ResearchRunCoverage;
}

/**
 * In-memory ResearchRun store for unit tests.
 * Supports abort-before-commit simulation for crash recovery proofs.
 */
export class MemoryResearchRunStore implements ResearchRunStore {
  private readonly runs = new Map<string, ResearchRunRecord>();
  private readonly steps = new Map<string, ResearchRunStepCounts>();
  private readonly outbox: Array<{
    readonly runId: string;
    readonly eventType: string;
    readonly id: string;
  }> = [];
  /** When set, the next transition throws after validating but before mutating. */
  abortNextTransition = false;
  transitionAttempts = 0;
  /** Awaited after the version snapshot and before the CAS write — enables race tests. */
  beforeCommit: (() => Promise<void>) | null = null;

  seed(input: MemoryResearchRunSeed): ResearchRunRecord {
    const record: ResearchRunRecord = {
      id: input.id,
      orgId: input.orgId,
      projectId: input.projectId,
      state: input.state ?? 'CREATED',
      version: input.version ?? 0,
      reservedMicros: input.reservedMicros ?? 1_000_000n,
      consumedMicros: input.consumedMicros ?? 0n,
      coverage: input.coverage ?? emptyResearchRunCoverage(),
      startedAt: null,
      terminalAt: null,
    };
    this.runs.set(record.id, record);
    this.steps.set(record.id, {
      ready: 0,
      inFlight: 0,
      pending: 0,
      deferred: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });
    return record;
  }

  setStepCounts(runId: string, counts: Partial<ResearchRunStepCounts>): void {
    const current = this.steps.get(runId) ?? {
      ready: 0,
      inFlight: 0,
      pending: 0,
      deferred: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    this.steps.set(runId, { ...current, ...counts });
  }

  listOutbox(): readonly {
    readonly runId: string;
    readonly eventType: string;
    readonly id: string;
  }[] {
    return this.outbox;
  }

  async getById(runId: string): Promise<ResearchRunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async countSteps(runId: string): Promise<ResearchRunStepCounts> {
    return (
      this.steps.get(runId) ?? {
        ready: 0,
        inFlight: 0,
        pending: 0,
        deferred: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      }
    );
  }

  async transition(input: ResearchRunTransitionInput): Promise<ResearchRunTransitionResult> {
    this.transitionAttempts += 1;
    if (!canTransitionResearchRun(input.fromState, input.toState)) {
      throw new ResearchRunTransitionError(input.fromState, input.toState);
    }

    if (this.abortNextTransition) {
      this.abortNextTransition = false;
      throw new Error('simulated coordinator crash mid-tick');
    }

    const current = this.runs.get(input.runId);
    if (current === undefined) {
      throw new Error(`ResearchRun ${input.runId} not found`);
    }

    if (current.state !== input.fromState || current.version !== input.expectedVersion) {
      return { kind: 'version_conflict', run: current };
    }

    if (this.beforeCommit !== null) {
      await this.beforeCommit();
    }

    const latest = this.runs.get(input.runId);
    if (
      latest === undefined ||
      latest.state !== input.fromState ||
      latest.version !== input.expectedVersion
    ) {
      return { kind: 'version_conflict', run: latest ?? current };
    }

    const now = new Date();
    const next: ResearchRunRecord = {
      ...latest,
      state: input.toState,
      version: latest.version + 1,
      coverage: input.coverage ?? latest.coverage,
      startedAt:
        input.toState === 'RUNNING' && input.fromState === 'PLANNING'
          ? now
          : latest.startedAt,
      terminalAt: isResearchRunTerminal(input.toState) ? now : latest.terminalAt,
    };
    this.runs.set(input.runId, next);

    if (input.cancelSteps === true && input.toState === 'CANCELLED') {
      const counts = await this.countSteps(input.runId);
      this.steps.set(input.runId, {
        ...counts,
        ready: 0,
        inFlight: 0,
        pending: 0,
        deferred: 0,
        cancelled:
          counts.cancelled +
          counts.ready +
          counts.inFlight +
          counts.pending +
          counts.deferred +
          counts.failed,
        failed: 0,
      });
    }

    const outboxEventIds: string[] = [];
    for (const event of input.outboxEvents) {
      this.outbox.push({
        runId: input.runId,
        eventType: event.eventType,
        id: event.id,
      });
      outboxEventIds.push(event.id);
    }

    return { kind: 'applied', run: next, outboxEventIds };
  }

  /** Expose failed-reason acceptance for narrow-FAILED tests via transition input. */
  lastFailedReason: ResearchRunFailedReason | undefined;
}
