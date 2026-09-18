import { Inject, Injectable } from '@nestjs/common';
import {
  RESEARCH_RUN_STORE,
  isFullResearchRunCoverage,
  isResearchRunTerminal,
  type ResearchRunFailedReason,
  type ResearchRunRecord,
  type ResearchRunStateName,
  type ResearchRunStore,
  type ResearchRunTransitionResult,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { JobEnqueueService } from '../platform/logging';
import { ResearchRunCoordinationService } from './research-run-coordination.service';
import { ResearchRunMetrics } from './research-run.metrics';
import { ResearchRunTransitionService } from './research-run-transition.service';

const MODULE = 'orchestration';

export type PlanningDecision =
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: ResearchRunFailedReason };

export type ResearchRunTickOutcome =
  | {
      readonly kind: 'transitioned';
      readonly fromState: ResearchRunStateName;
      readonly toState: ResearchRunStateName;
      readonly result: ResearchRunTransitionResult;
    }
  | { readonly kind: 'noop'; readonly reason: string; readonly state: ResearchRunStateName }
  | { readonly kind: 'version_conflict'; readonly state: ResearchRunStateName };

/**
 * Optional planning hook — DHB-65 owns full DAG/presets.
 * Default: succeed planning (zero-source / failure injected by tests or callers).
 */
export type ResearchRunPlanningHook = (
  run: ResearchRunRecord,
) => Promise<PlanningDecision> | PlanningDecision;

@Injectable()
export class ResearchRunCoordinatorService {
  private planningHook: ResearchRunPlanningHook = () => ({ kind: 'ready' });
  /** Side-effect counter for crash/recovery proofs — increments only on applied transitions. */
  private appliedChargeCount = 0;

  constructor(
    @Inject(RESEARCH_RUN_STORE) private readonly store: ResearchRunStore,
    private readonly transitions: ResearchRunTransitionService,
    private readonly coordination: ResearchRunCoordinationService,
    private readonly metrics: ResearchRunMetrics,
    private readonly enqueue: JobEnqueueService,
  ) {}

  /** Test hook — swap planning outcome without Temporal/Airflow. */
  setPlanningHook(hook: ResearchRunPlanningHook): void {
    this.planningHook = hook;
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
    const steps = await this.store.countSteps(run.id);

    if (run.consumedMicros >= run.reservedMicros && steps.ready > 0) {
      return this.transitionOutcome(
        run,
        await this.applyTransition(run, 'PAUSED_BUDGET'),
      );
    }

    if (steps.ready === 0 && steps.inFlight === 0 && steps.pending === 0) {
      return this.transitionOutcome(run, await this.applyTransition(run, 'COMPLETING'));
    }

    return { kind: 'noop', reason: 'awaiting_steps', state: run.state };
  }

  private async advanceCompleting(run: ResearchRunRecord): Promise<ResearchRunTickOutcome> {
    const toState: ResearchRunStateName = isFullResearchRunCoverage(run.coverage)
      ? 'COMPLETED'
      : 'COMPLETED_PARTIAL';
    return this.transitionOutcome(run, await this.applyTransition(run, toState));
  }

  private async applyTransition(
    run: ResearchRunRecord,
    toState: ResearchRunStateName,
    options?: { readonly failedReason?: ResearchRunFailedReason },
  ): Promise<ResearchRunTransitionResult> {
    const result = await this.transitions.transition({
      runId: run.id,
      toState,
      expectedVersion: run.version,
      ...(options?.failedReason !== undefined
        ? { failedReason: options.failedReason }
        : {}),
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
