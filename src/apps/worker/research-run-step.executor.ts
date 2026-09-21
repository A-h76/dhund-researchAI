import { Inject, Injectable } from '@nestjs/common';
import { EVIDENCE_EXTRACT_STEP_TYPE } from '../../evidence/extract.constants';
import { SYNTHESIS_PROMPT_VERSION } from '../../evidence/synthesis.constants';
import { requestExtractJob } from '../../ingestion/request-extract';
import {
  RESEARCH_RUN_STORE,
  type ResearchRunStepRecord,
  type ResearchRunStore,
} from '../../l0/ports';
import { OutboxWriterService } from '../../platform/events';
import { generateId } from '../../platform/ids/uuid-v7';
import { JobEnqueueService, requireCorrelationId } from '../../platform/logging';
import { RuntimeRole } from '../../platform/runtime/role';
import { isResearchRunStepType } from '../../orchestration/presets/research-run-dag';
import { ResearchRunMetrics } from '../../orchestration/research-run.metrics';
import { RETRIEVAL_SERVICE, type IRetrievalService } from '../../retrieval/retrieval.port';
import {
  EvidenceExtractService,
  type EvidenceExtractJobPayload,
} from './evidence-extract.service';

export interface ResearchRunStepJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly stepType: string;
  readonly inputFingerprint: string;
  readonly stepVersion: string;
  readonly correlationId: string;
  readonly query?: string;
  readonly documentVersionId?: string;
  readonly contentHash?: string;
  readonly sourceId?: string;
}

@Injectable()
export class ResearchRunStepExecutor {
  constructor(
    @Inject(RESEARCH_RUN_STORE) private readonly store: ResearchRunStore,
    @Inject(RETRIEVAL_SERVICE) private readonly retrieval: IRetrievalService,
    private readonly enqueue: JobEnqueueService,
    private readonly extract: EvidenceExtractService,
    private readonly outbox: OutboxWriterService,
    private readonly metrics: ResearchRunMetrics,
  ) {}

  async execute(
    payload: ResearchRunStepJobPayload,
    options?: { onHeartbeat?: () => Promise<void> },
  ): Promise<void> {
    const started = Date.now();
    const existing = await this.store.getStep(payload.stepId);

    if (existing === null) {
      if (payload.stepType === EVIDENCE_EXTRACT_STEP_TYPE) {
        await this.extract.execute(toEvidencePayload(payload), options);
      }
      this.metrics.recordStepLatency(payload.stepType, Date.now() - started);
      this.metrics.recordStepOutcome('succeeded');
      return;
    }

    if (
      existing.state === 'SUCCEEDED' ||
      existing.state === 'FAILED' ||
      existing.state === 'CANCELLED'
    ) {
      return;
    }

    if (!depsSucceeded(existing, await this.store.listSteps(existing.runId))) {
      if (existing.state === 'DISPATCHED') {
        await this.store.transitionStep({
          stepId: existing.id,
          fromState: 'DISPATCHED',
          toState: 'READY',
          expectedVersion: existing.version,
        });
      }
      return;
    }

    const running = await this.claimRunning(existing);
    if (running === null) {
      return;
    }

    if (payload.stepType === EVIDENCE_EXTRACT_STEP_TYPE) {
      await this.extract.execute(toEvidencePayload(payload), options);
      await this.succeed(payload, running, null, null);
    } else if (!isResearchRunStepType(payload.stepType)) {
      await this.succeed(payload, running, null, null);
    } else {
      switch (payload.stepType) {
        case 'retrieve': {
          const result = await this.retrieval.retrieve({
            orgId: payload.orgId,
            projectId: payload.projectId,
            query: payload.query ?? 'deep research',
            k: 10,
            correlationId: payload.correlationId,
            runtimeRole: RuntimeRole.Worker,
          });
          await this.succeed(payload, running, result.trace.id, result.trace.fingerprint);
          break;
        }
        case 'admit': {
          if (
            payload.documentVersionId !== undefined &&
            payload.documentVersionId.length > 0 &&
            payload.contentHash !== undefined &&
            payload.contentHash.length > 0
          ) {
            const jobId = await requestExtractJob(this.enqueue, {
              orgId: payload.orgId,
              projectId: payload.projectId,
              documentVersionId: payload.documentVersionId,
              contentHash: payload.contentHash,
            });
            await this.succeed(payload, running, jobId, null);
          } else {
            await this.succeed(payload, running, null, null);
          }
          break;
        }
        case 'evidence-extract': {
          await this.extract.execute(toEvidencePayload(payload), options);
          await this.succeed(payload, running, null, null);
          break;
        }
        case 'synthesis': {
          const claimId = generateId();
          const jobId = await this.enqueue.enqueue('synthesis', {
            orgId: payload.orgId,
            projectId: payload.projectId,
            runId: payload.runId,
            claimId,
            promptVersion: SYNTHESIS_PROMPT_VERSION,
          });
          await this.succeed(payload, running, jobId, null);
          break;
        }
        default: {
          const _exhaustive: never = payload.stepType;
          return _exhaustive;
        }
      }
    }

    this.metrics.recordStepLatency(payload.stepType, Date.now() - started);
    this.metrics.recordStepOutcome('succeeded');
  }

  async fail(payload: ResearchRunStepJobPayload): Promise<void> {
    const step = await this.store.getStep(payload.stepId);
    if (step === null) {
      return;
    }
    if (step.state !== 'DISPATCHED' && step.state !== 'RUNNING') {
      return;
    }
    await this.store.transitionStep({
      stepId: step.id,
      fromState: step.state,
      toState: 'FAILED',
      expectedVersion: step.version,
    });
    this.metrics.recordStepOutcome('failed');
  }

  private async claimRunning(
    step: ResearchRunStepRecord,
  ): Promise<ResearchRunStepRecord | null> {
    if (step.state === 'RUNNING') {
      return step;
    }
    if (step.state !== 'DISPATCHED') {
      return null;
    }
    const claimed = await this.store.transitionStep({
      stepId: step.id,
      fromState: 'DISPATCHED',
      toState: 'RUNNING',
      expectedVersion: step.version,
      incrementAttempt: true,
    });
    return claimed.kind === 'applied' ? claimed.step : null;
  }

  private async succeed(
    payload: ResearchRunStepJobPayload,
    step: ResearchRunStepRecord,
    resultRef: string | null,
    inputFingerprint: string | null,
  ): Promise<void> {
    const events = [
      this.outbox.buildInsert({
        eventType: 'orchestration.step.completed',
        aggregateType: 'research_run_step',
        aggregateId: step.id,
        orgId: payload.orgId,
        projectId: payload.projectId,
        payload: {
          orgId: payload.orgId,
          projectId: payload.projectId,
          runId: payload.runId,
          stepId: step.id,
          stepType: payload.stepType,
        },
        correlationId: requireCorrelationId(),
      }),
    ];
    await this.store.transitionStep({
      stepId: step.id,
      fromState: 'RUNNING',
      toState: 'SUCCEEDED',
      expectedVersion: step.version,
      resultRef,
      ...(inputFingerprint !== null ? { inputFingerprint } : {}),
      outboxEvents: events,
    });
  }
}

function depsSucceeded(
  step: ResearchRunStepRecord,
  all: readonly ResearchRunStepRecord[],
): boolean {
  if (step.dependsOnStepIds.length === 0) {
    return true;
  }
  const byId = new Map(all.map((item) => [item.id, item]));
  return step.dependsOnStepIds.every((id) => byId.get(id)?.state === 'SUCCEEDED');
}

function toEvidencePayload(payload: ResearchRunStepJobPayload): EvidenceExtractJobPayload {
  return {
    orgId: payload.orgId,
    projectId: payload.projectId,
    runId: payload.runId,
    stepId: payload.stepId,
    stepType: payload.stepType,
    inputFingerprint: payload.inputFingerprint,
    stepVersion: payload.stepVersion,
    sourceId: payload.sourceId ?? '',
    documentVersionId: payload.documentVersionId ?? '',
    correlationId: payload.correlationId,
  };
}
