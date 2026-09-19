import { Inject, Injectable } from '@nestjs/common';
import {
  RESEARCH_RUN_STORE,
  aggregateResearchRunStepOutcomes,
  computeFinalResearchRunCoverage,
  hashResearchRunCoverage,
  isFullResearchRunCoverage,
  isResearchRunTerminal,
  ResearchRunCoverageError,
  type ResearchRunCoverage,
  type ResearchRunFailedReason,
  type ResearchRunPresetName,
  type ResearchRunRecord,
  type ResearchRunStateName,
  type ResearchRunStepRecord,
  type ResearchRunStore,
  type ResearchRunTransitionResult,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { JobEnqueueService } from '../platform/logging';
import {
  RESEARCH_RUN_PER_STEP_CEILING_MICROS,
  assertIntegerMicrosBigInt,
  canReserveDispatch,
  isBudgetCapReached,
  measuredOverageMicros,
} from './budget/research-run-budget';
import { findDagNode, resolveResearchRunPreset } from './presets/resolve-preset';
import { artifactTypesForPreset } from './research-artifact-types';
import { ResearchRunCoordinationService } from './research-run-coordination.service';
import { ResearchRunMetrics } from './research-run.metrics';
import {
  ResearchRunPlannerService,
  type PlanningDecision,
} from './research-run-planner.service';
import { ResearchRunTransitionService } from './research-run-transition.service';

const MODULE = 'orchestration';

export type { PlanningDecision };

export type ResearchRunTickOutcome =
  | {
      readonly kind: 'transitioned';
      readonly fromState: ResearchRunStateName;
      readonly toState: ResearchRunStateName;
      readonly result: ResearchRunTransitionResult;
    }
  | { readonly kind: 'noop'; readonly reason: string; readonly state: ResearchRunStateName }
  | { readonly kind: 'version_conflict'; readonly state: ResearchRunStateName };

export type ResearchRunPlanningHook = (
  run: ResearchRunRecord,
) => Promise<PlanningDecision> | PlanningDecision;

@Injectable()
export class ResearchRunCoordinatorService {
  private planningHook: ResearchRunPlanningHook;
  /** Side-effect counter for crash/recovery proofs — increments only on applied transitions. */
  private appliedChargeCount = 0;
  private perStepCeilingMicros = RESEARCH_RUN_PER_STEP_CEILING_MICROS;

  constructor(
    @Inject(RESEARCH_RUN_STORE) private readonly store: ResearchRunStore,
    private readonly transitions: ResearchRunTransitionService,
    private readonly coordination: ResearchRunCoordinationService,
    private readonly metrics: ResearchRunMetrics,
    private readonly enqueue: JobEnqueueService,
    private readonly planner: ResearchRunPlannerService,
  ) {
    this.planningHook = (run) => this.planner.plan(run);
  }

  /** Test hook — swap planning outcome without Temporal/Airflow. */
  setPlanningHook(hook: ResearchRunPlanningHook): void {
    this.planningHook = hook;
  }

  /** Test hook — override per-step ceiling for overage-bound proofs. */
  setPerStepCeilingMicros(ceiling: bigint): void {
    assertIntegerMicrosBigInt(ceiling);
    if (ceiling <= 0n) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'per-step ceiling must be a positive integer micros value',
      });
    }
    this.perStepCeilingMicros = ceiling;
  }

  getAppliedChargeCount(): number {
    return this.appliedChargeCount;
  }

  resetAppliedChargeCount(): void {
    this.appliedChargeCount = 0;
  }

  async enqueueTick(input: {
    readonly orgId: string;
    readonly projectId: string;
    readonly runId: string;
  }): Promise<string> {
    return this.enqueue.enqueue('research-run-tick', {
      orgId: input.orgId,
      projectId: input.projectId,
      runId: input.runId,
    });
  }

  /**
   * One coordinator tick for a run. Advisory lock is optional (GAP-COORD-LOCK-01);
   * version guard makes racing ticks safe.
   */
  async executeTick(input: {
    readonly runId: string;
    readonly recovery?: boolean;
  }): Promise<ResearchRunTickOutcome> {
    const started = Date.now();
    if (input.recovery === true) {
      this.metrics.recordRecovery();
    }

    try {
      return await this.coordination.withAdvisoryLock(
        `research_run:${input.runId}`,
        async () => this.advanceOnce(input.runId),
      );
    } finally {
      this.metrics.recordTick(Date.now() - started);
    }
  }

  async cancel(runId: string): Promise<ResearchRunTransitionResult> {
    const result = await this.transitions.cancel(runId);
    if (result.kind === 'applied') {
      this.appliedChargeCount += 1;
    }
    return result;
  }

  async pauseManual(runId: string): Promise<ResearchRunTransitionResult> {
    const run = await this.transitions.get(runId);
    return this.applyTransition(run, 'PAUSED_MANUAL');
  }

  /**
   * Increase reservedMicros (budget top-up). Does not resume — call resume()
   * after a PAUSED_BUDGET top-up (DHB-66).
   */
  async increaseBudget(
    runId: string,
    additionalMicros: bigint,
  ): Promise<ResearchRunRecord> {
    assertIntegerMicrosBigInt(additionalMicros);
    if (additionalMicros <= 0n) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'Budget increase must be a positive integer micros value.',
      });
    }

    const run = await this.transitions.get(runId);
    if (isResearchRunTerminal(run.state)) {
      throw new DomainError(ErrorCode.InvalidStateTransition, {
        module: MODULE,
        userMessage: `Cannot increase budget for terminal research run in state ${run.state}`,
      });
    }

    const result = await this.store.increaseReservedMicros({
      runId,
      additionalMicros,
      expectedVersion: run.version,
    });

    if (result.kind === 'not_found') {
      throw new DomainError(ErrorCode.NotFound, {
        module: MODULE,
        userMessage: 'Research run not found.',
      });
    }
    if (result.kind === 'version_conflict') {
      throw new DomainError(ErrorCode.InvalidStateTransition, {
        module: MODULE,
        userMessage: 'Research run version conflict while increasing budget.',
      });
    }

    this.metrics.recordBudgetIncrease({
      runId,
      additionalMicros,
      reservedMicros: result.run.reservedMicros,
    });
    return result.run;
  }

  /**
   * Top up reservedMicros then resume from PAUSED_BUDGET. Continues from
   * committed step state — no repeated work, no double charge (DHB-66).
   */
  async resumeAfterBudgetIncrease(
    runId: string,
    additionalMicros: bigint,
  ): Promise<ResearchRunTransitionResult> {
    await this.increaseBudget(runId, additionalMicros);
    return this.resume(runId);
  }

  async resume(runId: string): Promise<ResearchRunTransitionResult> {
    const run = await this.transitions.get(runId);
    if (run.state !== 'PAUSED_BUDGET' && run.state !== 'PAUSED_MANUAL') {
      throw new DomainError(ErrorCode.InvalidStateTransition, {
        module: MODULE,
        userMessage: `Cannot resume research run in state ${run.state}`,
      });
    }
    const result = await this.applyTransition(run, 'RUNNING');
    if (result.kind === 'applied') {
      await this.enqueueTick({
        orgId: run.orgId,
        projectId: run.projectId,
        runId: run.id,
      });
    }
    return result;
  }

  private async advanceOnce(runId: string): Promise<ResearchRunTickOutcome> {
    const run = await this.transitions.get(runId);

    if (isResearchRunTerminal(run.state)) {
      return { kind: 'noop', reason: 'terminal', state: run.state };
    }

    switch (run.state) {
      case 'CREATED':
        return this.transitionOutcome(run, await this.applyTransition(run, 'PLANNING'));
      case 'PLANNING':
        return this.advancePlanning(run);
      case 'RUNNING':
        return this.advanceRunning(run);
      case 'PAUSED_BUDGET':
      case 'PAUSED_MANUAL':
        return { kind: 'noop', reason: 'paused', state: run.state };
      case 'COMPLETING':
        return this.advanceCompleting(run);
      default: {
        const _exhaustive: never = run.state;
        return _exhaustive;
      }
    }
  }

  private async advancePlanning(run: ResearchRunRecord): Promise<ResearchRunTickOutcome> {
    const decision = await this.planningHook(run);
    if (decision.kind === 'failed') {
      return this.transitionOutcome(
        run,
        await this.applyTransition(run, 'FAILED', { failedReason: decision.reason }),
      );
    }
    return this.transitionOutcome(run, await this.applyTransition(run, 'RUNNING'));
  }

  private async advanceRunning(run: ResearchRunRecord): Promise<ResearchRunTickOutcome> {
    const listed = await this.store.listSteps(run.id);
    if (listed.length > 0) {
      return this.advanceRunningSteps(run, listed);
    }

    const steps = await this.store.countSteps(run.id);

    if (
      (isBudgetCapReached(run.reservedMicros, run.consumedMicros) ||
        !canReserveDispatch({
          reservedMicros: run.reservedMicros,
          consumedMicros: run.consumedMicros,
          inFlight: steps.inFlight,
          perStepCeilingMicros: this.perStepCeilingMicros,
        })) &&
      steps.ready > 0
    ) {
      return this.pauseForBudget(run, steps.inFlight);
    }

    if (steps.ready === 0 && steps.inFlight === 0 && steps.pending === 0) {
      return this.transitionOutcome(run, await this.applyTransition(run, 'COMPLETING'));
    }

    return { kind: 'noop', reason: 'awaiting_steps', state: run.state };
  }

  private async advanceRunningSteps(
    run: ResearchRunRecord,
    listed: readonly ResearchRunStepRecord[],
  ): Promise<ResearchRunTickOutcome> {
    const byId = new Map(listed.map((step) => [step.id, step]));
    await this.promoteSteps(listed, byId);

    const current = await this.store.listSteps(run.id);
    const ready = current.filter((step) => step.state === 'READY');
    let inFlight = current.filter(
      (step) => step.state === 'DISPATCHED' || step.state === 'RUNNING',
    ).length;

    let blockedByBudget = false;
    for (const step of ready) {
      if (
        isBudgetCapReached(run.reservedMicros, run.consumedMicros) ||
        !canReserveDispatch({
          reservedMicros: run.reservedMicros,
          consumedMicros: run.consumedMicros,
          inFlight,
          perStepCeilingMicros: this.perStepCeilingMicros,
        })
      ) {
        blockedByBudget = true;
        break;
      }
      await this.dispatchStep(run, step);
      inFlight += 1;
    }

    if (blockedByBudget) {
      return this.pauseForBudget(run, inFlight);
    }

    const afterDispatch = await this.store.listSteps(run.id);
    const stillReady = afterDispatch.some((step) => step.state === 'READY');
    const stillInFlight = afterDispatch.some(
      (step) => step.state === 'DISPATCHED' || step.state === 'RUNNING',
    );
    const stillPending = afterDispatch.some((step) => step.state === 'PENDING');

    if (!stillReady && !stillInFlight && !stillPending) {
      return this.transitionOutcome(run, await this.applyTransition(run, 'COMPLETING'));
    }

    return { kind: 'noop', reason: 'awaiting_steps', state: run.state };
  }

  private async pauseForBudget(
    run: ResearchRunRecord,
    inFlight: number,
  ): Promise<ResearchRunTickOutcome> {
    const overageMicros = measuredOverageMicros(run.reservedMicros, run.consumedMicros);
    this.metrics.recordBudgetPause({
      runId: run.id,
      consumedMicros: run.consumedMicros,
      reservedMicros: run.reservedMicros,
      overageMicros,
      inFlight,
    });
    return this.transitionOutcome(run, await this.applyTransition(run, 'PAUSED_BUDGET'));
  }

  private async promoteSteps(
    listed: readonly ResearchRunStepRecord[],
    byId: Map<string, ResearchRunStepRecord>,
  ): Promise<void> {
    for (const step of listed) {
      if (step.state !== 'PENDING') {
        continue;
      }
      const deps = step.dependsOnStepIds.map((id) => byId.get(id));
      if (deps.some((dep) => dep === undefined)) {
        continue;
      }
      const blocked = deps.some(
        (dep) =>
          dep !== undefined &&
          (dep.state === 'FAILED' || dep.state === 'CANCELLED' || dep.state === 'DEFERRED'),
      );
      if (blocked) {
        await this.store.transitionStep({
          stepId: step.id,
          fromState: 'PENDING',
          toState: 'DEFERRED',
          expectedVersion: step.version,
        });
        this.metrics.recordDeferred(1);
        continue;
      }
      const ready = deps.every((dep) => dep !== undefined && dep.state === 'SUCCEEDED');
      if (ready) {
        await this.store.transitionStep({
          stepId: step.id,
          fromState: 'PENDING',
          toState: 'READY',
          expectedVersion: step.version,
        });
      }
    }
  }

  private async dispatchStep(run: ResearchRunRecord, step: ResearchRunStepRecord): Promise<void> {
    const claimed = await this.store.transitionStep({
      stepId: step.id,
      fromState: 'READY',
      toState: 'DISPATCHED',
      expectedVersion: step.version,
    });
    if (claimed.kind !== 'applied') {
      return;
    }

    const resolved = resolveResearchRunPreset({
      preset: run.preset,
      customDag: run.customDag,
    });
    const node =
      resolved.kind === 'ok'
        ? findDagNode(resolved.dag, {
            runId: run.id,
            stepType: step.stepType,
            inputFingerprint: step.inputFingerprint,
          })
        : null;

    await this.enqueue.enqueue(
      'research-run-step',
      {
        orgId: run.orgId,
        projectId: run.projectId,
        runId: run.id,
        stepId: step.id,
        stepType: step.stepType,
        inputFingerprint: step.inputFingerprint,
        stepVersion: step.stepVersion,
        ...(node?.query !== undefined ? { query: node.query } : {}),
        ...(node?.documentVersionId !== undefined
          ? { documentVersionId: node.documentVersionId }
          : {}),
        ...(node?.contentHash !== undefined ? { contentHash: node.contentHash } : {}),
      },
      { stepType: step.stepType },
    );
  }

  private async advanceCompleting(run: ResearchRunRecord): Promise<ResearchRunTickOutcome> {
    let coverage: ResearchRunCoverage;
    try {
      // COMPLETING computes final coverage, then chooses COMPLETED vs COMPLETED_PARTIAL.
      coverage = computeFinalResearchRunCoverage(run.coverage);
    } catch (error) {
      if (error instanceof ResearchRunCoverageError) {
        throw new DomainError(ErrorCode.ValidationError, {
          module: MODULE,
          userMessage: error.message,
          cause: error,
        });
      }
      throw error;
    }

    const counts = await this.store.countSteps(run.id);
    // stepOutcomes stay outside coverage (GAP-COVERAGE-01) — recorded for observability only.
    const stepOutcomes = aggregateResearchRunStepOutcomes(counts);
    this.metrics.recordStepOutcomesAggregate(stepOutcomes);

    const toState: ResearchRunStateName =
      isFullResearchRunCoverage(coverage) && counts.failed === 0
        ? 'COMPLETED'
        : 'COMPLETED_PARTIAL';

    const result = await this.applyTransition(run, toState, { coverage });
    if (result.kind === 'applied') {
      this.metrics.recordCoverageFinalized(coverage, toState);
      await this.enqueueArtifactGeneration(result.run, coverage);
    }
    return this.transitionOutcome(run, result);
  }

  private async enqueueArtifactGeneration(
    run: ResearchRunRecord,
    coverage: ResearchRunCoverage,
  ): Promise<void> {
    const coverageSnapshotHash = hashResearchRunCoverage(coverage);
    const types = artifactTypesForPreset(run.preset as ResearchRunPresetName);
    for (const artifactType of types) {
      await this.enqueue.enqueue('research-artifact-generate', {
        orgId: run.orgId,
        projectId: run.projectId,
        runId: run.id,
        artifactType,
        coverageSnapshotHash,
        coverageSnapshot: coverage,
      });
    }
  }

  private async applyTransition(
    run: ResearchRunRecord,
    toState: ResearchRunStateName,
    options?: {
      readonly failedReason?: ResearchRunFailedReason;
      readonly coverage?: ResearchRunCoverage;
    },
  ): Promise<ResearchRunTransitionResult> {
    const result = await this.transitions.transition({
      runId: run.id,
      toState,
      expectedVersion: run.version,
      ...(options?.failedReason !== undefined
        ? { failedReason: options.failedReason }
        : {}),
      ...(options?.coverage !== undefined ? { coverage: options.coverage } : {}),
    });
    if (result.kind === 'applied') {
      // One charge unit per applied coordinator transition — crash before commit charges 0.
      this.appliedChargeCount += 1;
    }
    return result;
  }

  private transitionOutcome(
    run: ResearchRunRecord,
    result: ResearchRunTransitionResult,
  ): ResearchRunTickOutcome {
    if (result.kind === 'version_conflict') {
      return { kind: 'version_conflict', state: result.run.state };
    }
    return {
      kind: 'transitioned',
      fromState: run.state,
      toState: result.run.state,
      result,
    };
  }
}
