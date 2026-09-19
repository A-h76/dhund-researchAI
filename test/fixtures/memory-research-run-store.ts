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
import {
  canTransitionResearchStep,
} from '../../src/l0/ports/research-run-step-state';
import type {
  ResearchRunIncreaseBudgetInput,
  ResearchRunIncreaseBudgetResult,
  ResearchRunPresetName,
  ResearchRunRecord,
  ResearchRunStepCounts,
  ResearchRunStepRecord,
  ResearchRunStepSeed,
  ResearchRunStepTransitionInput,
  ResearchRunStepTransitionResult,
  ResearchRunStore,
  ResearchRunTransitionInput,
  ResearchRunTransitionResult,
} from '../../src/l0/ports/research-run-store.port';

export interface MemoryResearchRunSeed {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly preset?: ResearchRunPresetName;
  readonly customDag?: unknown | null;
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
  private readonly counts = new Map<string, ResearchRunStepCounts>();
  private readonly steps = new Map<string, ResearchRunStepRecord>();
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
      preset: input.preset ?? 'deep_research',
      customDag: input.customDag ?? null,
      state: input.state ?? 'CREATED',
      version: input.version ?? 0,
      reservedMicros: input.reservedMicros ?? 1_000_000n,
      consumedMicros: input.consumedMicros ?? 0n,
      coverage: input.coverage ?? emptyResearchRunCoverage(),
      startedAt: null,
      terminalAt: null,
    };
    this.runs.set(record.id, record);
    this.counts.set(record.id, emptyCounts());
    return record;
  }

  setStepCounts(runId: string, counts: Partial<ResearchRunStepCounts>): void {
    const current = this.counts.get(runId) ?? emptyCounts();
    this.counts.set(runId, { ...current, ...counts });
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
    const fromRows = this.stepsForRun(runId);
    if (fromRows.length > 0) {
      return countsFromSteps(fromRows);
    }
    return this.counts.get(runId) ?? emptyCounts();
  }

  async listSteps(runId: string): Promise<readonly ResearchRunStepRecord[]> {
    return this.stepsForRun(runId);
  }

  async getStep(stepId: string): Promise<ResearchRunStepRecord | null> {
    return this.steps.get(stepId) ?? null;
  }

  async createSteps(runId: string, seeds: readonly ResearchRunStepSeed[]): Promise<void> {
    for (const seed of seeds) {
      const duplicate = [...this.steps.values()].some(
        (step) =>
          step.runId === runId &&
          step.stepType === seed.stepType &&
          step.inputFingerprint === seed.inputFingerprint &&
          step.stepVersion === seed.stepVersion,
      );
      if (duplicate) {
        continue;
      }
      this.steps.set(seed.id, {
        id: seed.id,
        runId,
        stepType: seed.stepType,
        dependsOnStepIds: seed.dependsOnStepIds,
        inputFingerprint: seed.inputFingerprint,
        stepVersion: seed.stepVersion,
        state: seed.state,
        attemptCount: 0,
        resultRef: null,
        version: 0,
      });
    }
  }

  async transitionStep(
    input: ResearchRunStepTransitionInput,
  ): Promise<ResearchRunStepTransitionResult> {
    if (!canTransitionResearchStep(input.fromState, input.toState)) {
      throw new Error(`Forbidden research-run-step transition ${input.fromState} -> ${input.toState}`);
    }
    const current = this.steps.get(input.stepId);
    if (current === undefined) {
      return { kind: 'not_found' };
    }
    if (current.state !== input.fromState || current.version !== input.expectedVersion) {
      return { kind: 'version_conflict', step: current };
    }
    const next: ResearchRunStepRecord = {
      ...current,
      state: input.toState,
      version: current.version + 1,
      attemptCount:
        input.incrementAttempt === true ? current.attemptCount + 1 : current.attemptCount,
      resultRef: input.resultRef !== undefined ? input.resultRef : current.resultRef,
      inputFingerprint: input.inputFingerprint ?? current.inputFingerprint,
    };
    this.steps.set(input.stepId, next);
    if (input.outboxEvents !== undefined) {
      for (const event of input.outboxEvents) {
        this.outbox.push({
          runId: current.runId,
          eventType: event.eventType,
          id: event.id,
        });
      }
    }
    return { kind: 'applied', step: next };
  }

  /** Test helper — simulate synchronous ledger debit onto consumedMicros. */
  debitConsumed(runId: string, costMicros: bigint): void {
    if (costMicros < 0n) {
      throw new Error('costMicros must be non-negative');
    }
    const current = this.runs.get(runId);
    if (current === undefined) {
      throw new Error(`ResearchRun ${runId} not found`);
    }
    this.runs.set(runId, {
      ...current,
      consumedMicros: current.consumedMicros + costMicros,
    });
  }

  async increaseReservedMicros(
    input: ResearchRunIncreaseBudgetInput,
  ): Promise<ResearchRunIncreaseBudgetResult> {
    if (input.additionalMicros <= 0n) {
      throw new Error('additionalMicros must be positive');
    }
    const current = this.runs.get(input.runId);
    if (current === undefined) {
      return { kind: 'not_found' };
    }
    if (current.version !== input.expectedVersion) {
      return { kind: 'version_conflict', run: current };
    }
    const next: ResearchRunRecord = {
      ...current,
      reservedMicros: current.reservedMicros + input.additionalMicros,
      version: current.version + 1,
    };
    this.runs.set(input.runId, next);
    return { kind: 'applied', run: next };
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
      this.rewriteSteps(input.runId, (step) =>
        step.state === 'SUCCEEDED' ? step : { ...step, state: 'CANCELLED', version: step.version + 1 },
      );
      const counts = await this.countSteps(input.runId);
      this.counts.set(input.runId, {
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

    if (input.toState === 'PAUSED_BUDGET' || input.toState === 'COMPLETING') {
      this.rewriteSteps(input.runId, (step) =>
        step.state === 'PENDING' || step.state === 'READY'
          ? { ...step, state: 'DEFERRED', version: step.version + 1 }
          : step,
      );
    }

    if (
      input.toState === 'RUNNING' &&
      (input.fromState === 'PAUSED_BUDGET' || input.fromState === 'PAUSED_MANUAL')
    ) {
      this.rewriteSteps(input.runId, (step) =>
        step.state === 'DEFERRED' ? { ...step, state: 'PENDING', version: step.version + 1 } : step,
      );
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

  private stepsForRun(runId: string): ResearchRunStepRecord[] {
    return [...this.steps.values()].filter((step) => step.runId === runId);
  }

  private rewriteSteps(
    runId: string,
    map: (step: ResearchRunStepRecord) => ResearchRunStepRecord,
  ): void {
    for (const step of this.stepsForRun(runId)) {
      this.steps.set(step.id, map(step));
    }
  }
}

function emptyCounts(): ResearchRunStepCounts {
  return {
    ready: 0,
    inFlight: 0,
    pending: 0,
    deferred: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
}

function countsFromSteps(steps: readonly ResearchRunStepRecord[]): ResearchRunStepCounts {
  const counts = emptyCounts();
  const next = { ...counts };
  for (const step of steps) {
    switch (step.state) {
      case 'READY':
        next.ready += 1;
        break;
      case 'DISPATCHED':
      case 'RUNNING':
        next.inFlight += 1;
        break;
      case 'PENDING':
        next.pending += 1;
        break;
      case 'DEFERRED':
        next.deferred += 1;
        break;
      case 'SUCCEEDED':
        next.succeeded += 1;
        break;
      case 'FAILED':
        next.failed += 1;
        break;
      case 'CANCELLED':
        next.cancelled += 1;
        break;
      default: {
        const _exhaustive: never = step.state;
        return _exhaustive;
      }
    }
  }
  return next;
}
