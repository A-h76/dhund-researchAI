import { Inject, Injectable } from '@nestjs/common';
import {
  RESEARCH_RUN_STORE,
  type ResearchRunCoverage,
  type ResearchRunFailedReason,
  type ResearchRunRecord,
  type ResearchRunStateName,
  type ResearchRunStore,
  type ResearchRunTransitionResult,
  assertCanEnterFailed,
  canTransitionResearchRun,
  isResearchRunTerminal,
  ResearchRunTransitionError,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { OutboxWriterService } from '../platform/events';
import { ResearchRunCoordinationService } from './research-run-coordination.service';
import { ResearchRunMetrics } from './research-run.metrics';

const MODULE = 'orchestration';

export interface TransitionResearchRunInput {
  readonly runId: string;
  readonly toState: ResearchRunStateName;
  readonly expectedVersion?: number;
  readonly coverage?: ResearchRunCoverage;
  readonly failedReason?: ResearchRunFailedReason;
  readonly mode?: string;
}

@Injectable()
export class ResearchRunTransitionService {
  constructor(
    @Inject(RESEARCH_RUN_STORE) private readonly store: ResearchRunStore,
    private readonly outboxWriter: OutboxWriterService,
    private readonly coordination: ResearchRunCoordinationService,
    private readonly metrics: ResearchRunMetrics,
  ) {}

  async get(runId: string): Promise<ResearchRunRecord> {
    const run = await this.store.getById(runId);
    if (run === null) {
      throw new DomainError(ErrorCode.NotFound, {
        module: MODULE,
        userMessage: 'Research run not found.',
      });
    }
    return run;
  }

  async transition(input: TransitionResearchRunInput): Promise<ResearchRunTransitionResult> {
    const run = await this.get(input.runId);
    const fromState = run.state;
    const toState = input.toState;

    if (!canTransitionResearchRun(fromState, toState)) {
      throw new DomainError(ErrorCode.InvalidStateTransition, {
        module: MODULE,
        userMessage: `Forbidden research-run transition ${fromState} -> ${toState}`,
        cause: new ResearchRunTransitionError(fromState, toState),
      });
    }

    if (toState === 'FAILED') {
      if (input.failedReason === undefined) {
        throw new DomainError(ErrorCode.InvalidStateTransition, {
          module: MODULE,
          userMessage: 'FAILED requires a narrow planning reason.',
        });
      }
      assertCanEnterFailed(input.failedReason);
    }

    const expectedVersion = input.expectedVersion ?? run.version;
    const nextVersion = expectedVersion + 1;
    const outboxEvents = this.buildLifecycleEvents({
      run,
      fromState,
      toState,
      version: nextVersion,
      failedReason: input.failedReason,
      mode: input.mode ?? 'research',
    });

    const result = await this.store.transition({
      runId: input.runId,
      fromState,
      toState,
      expectedVersion,
      outboxEvents,
      useAdvisoryLock: this.coordination.areAdvisoryLocksEnabled(),
      ...(input.coverage !== undefined ? { coverage: input.coverage } : {}),
      ...(input.failedReason !== undefined ? { failedReason: input.failedReason } : {}),
      ...(toState === 'CANCELLED' ? { cancelSteps: true } : {}),
    });

    if (result.kind === 'applied') {
      this.metrics.recordAppliedTransition(fromState, toState);
    } else {
      this.metrics.recordVersionConflict();
    }

    return result;
  }

  private buildLifecycleEvents(input: {
    readonly run: ResearchRunRecord;
    readonly fromState: ResearchRunStateName;
    readonly toState: ResearchRunStateName;
    readonly version: number;
    readonly failedReason?: ResearchRunFailedReason;
    readonly mode: string;
  }) {
    const events = [
      this.outboxWriter.buildInsert({
        eventType: 'orchestration.research_run.state_changed',
        aggregateType: 'research_run',
        aggregateId: input.run.id,
        orgId: input.run.orgId,
        projectId: input.run.projectId,
        payload: {
          orgId: input.run.orgId,
          projectId: input.run.projectId,
          runId: input.run.id,
          fromState: input.fromState,
          toState: input.toState,
          version: input.version,
        },
      }),
    ];

    if (input.toState === 'RUNNING' && input.fromState === 'PLANNING') {
      events.push(
        this.outboxWriter.buildInsert({
          eventType: 'orchestration.research_run.started',
          aggregateType: 'research_run',
          aggregateId: input.run.id,
          orgId: input.run.orgId,
          projectId: input.run.projectId,
          payload: {
            orgId: input.run.orgId,
            projectId: input.run.projectId,
            runId: input.run.id,
            mode: input.mode,
          },
        }),
      );
    }

    if (input.toState === 'COMPLETED' || input.toState === 'COMPLETED_PARTIAL') {
      events.push(
        this.outboxWriter.buildInsert({
          eventType: 'orchestration.research_run.completed',
          aggregateType: 'research_run',
          aggregateId: input.run.id,
          orgId: input.run.orgId,
          projectId: input.run.projectId,
          payload: {
            orgId: input.run.orgId,
            projectId: input.run.projectId,
            runId: input.run.id,
            status: input.toState,
          },
        }),
      );
    }

    if (input.toState === 'FAILED') {
      events.push(
        this.outboxWriter.buildInsert({
          eventType: 'orchestration.research_run.failed',
          aggregateType: 'research_run',
          aggregateId: input.run.id,
          orgId: input.run.orgId,
          projectId: input.run.projectId,
          payload: {
            orgId: input.run.orgId,
            projectId: input.run.projectId,
            runId: input.run.id,
            errorCode: input.failedReason ?? 'planning_failure',
          },
        }),
      );
    }

    return events;
  }

  async cancel(runId: string): Promise<ResearchRunTransitionResult> {
    const run = await this.get(runId);
    if (isResearchRunTerminal(run.state)) {
      throw new DomainError(ErrorCode.InvalidStateTransition, {
        module: MODULE,
        userMessage: `Cannot cancel terminal research run in state ${run.state}`,
      });
    }
    return this.transition({ runId, toState: 'CANCELLED', expectedVersion: run.version });
  }
}
