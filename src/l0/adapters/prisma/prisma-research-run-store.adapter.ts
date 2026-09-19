import { Injectable } from '@nestjs/common';
import { Prisma, type ResearchRunState, type ResearchStepState } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import {
  parseResearchRunCoverage,
  type ResearchRunCoverage,
} from '../../ports/research-run-coverage';
import {
  canTransitionResearchRun,
  isResearchRunState,
  isResearchRunTerminal,
  ResearchRunTransitionError,
  type ResearchRunStateName,
} from '../../ports/research-run-state';
import {
  canTransitionResearchStep,
  isResearchStepState,
  type ResearchStepStateName,
} from '../../ports/research-run-step-state';
import {
  isResearchRunPreset,
  type ResearchRunIncreaseBudgetInput,
  type ResearchRunIncreaseBudgetResult,
  type ResearchRunPresetName,
  type ResearchRunRecord,
  type ResearchRunStepCounts,
  type ResearchRunStepRecord,
  type ResearchRunStepSeed,
  type ResearchRunStepTransitionInput,
  type ResearchRunStepTransitionResult,
  type ResearchRunStore,
  type ResearchRunTransitionInput,
  type ResearchRunTransitionResult,
} from '../../ports/research-run-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

const TERMINAL_STEP_DEFER_FROM: ResearchStepState[] = ['PENDING', 'READY'];
const CANCEL_STEP_FROM: ResearchStepState[] = [
  'PENDING',
  'READY',
  'DISPATCHED',
  'RUNNING',
  'DEFERRED',
  'FAILED',
];

@Injectable()
export class PrismaResearchRunStoreAdapter implements ResearchRunStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async getById(runId: string): Promise<ResearchRunRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().researchRun.findUnique({
        where: { id: runId },
      });
      return row === null ? null : this.toRecord(row);
    } catch (error) {
      throw new L0OperationError('ResearchRun get failed', error);
    }
  }

  async countSteps(runId: string): Promise<ResearchRunStepCounts> {
    await this.database.connect();
    try {
      const rows = await this.client().researchRunStep.groupBy({
        by: ['state'],
        where: { runId },
        _count: { _all: true },
      });
      return countsFromGroups(rows);
    } catch (error) {
      throw new L0OperationError('ResearchRun step count failed', error);
    }
  }

  async listSteps(runId: string): Promise<readonly ResearchRunStepRecord[]> {
    await this.database.connect();
    try {
      const rows = await this.client().researchRunStep.findMany({
        where: { runId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => this.toStep(row));
    } catch (error) {
      throw new L0OperationError('ResearchRun list steps failed', error);
    }
  }

  async getStep(stepId: string): Promise<ResearchRunStepRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().researchRunStep.findUnique({
        where: { id: stepId },
      });
      return row === null ? null : this.toStep(row);
    } catch (error) {
      throw new L0OperationError('ResearchRun get step failed', error);
    }
  }

  async createSteps(runId: string, steps: readonly ResearchRunStepSeed[]): Promise<void> {
    if (steps.length === 0) {
      return;
    }
    await this.database.connect();
    try {
      await this.client().researchRunStep.createMany({
        data: steps.map((step) => ({
          id: step.id,
          runId,
          stepType: step.stepType,
          dependsOnStepIds: [...step.dependsOnStepIds],
          inputFingerprint: step.inputFingerprint,
          stepVersion: step.stepVersion,
          state: step.state as ResearchStepState,
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      throw new L0OperationError('ResearchRun create steps failed', error);
    }
  }

  async transitionStep(
    input: ResearchRunStepTransitionInput,
  ): Promise<ResearchRunStepTransitionResult> {
    if (!canTransitionResearchStep(input.fromState, input.toState)) {
      throw new L0OperationError(
        `Forbidden research-run-step transition ${input.fromState} -> ${input.toState}`,
        undefined,
      );
    }

    await this.database.connect();
    try {
      return await this.client().$transaction(async (tx) => {
        const data: Prisma.ResearchRunStepUpdateManyMutationInput = {
          state: input.toState as ResearchStepState,
          version: { increment: 1 },
        };
        if (input.resultRef !== undefined) {
          data.resultRef = input.resultRef;
        }
        if (input.inputFingerprint !== undefined) {
          data.inputFingerprint = input.inputFingerprint;
        }
        if (input.incrementAttempt === true) {
          data.attemptCount = { increment: 1 };
        }

        const updated = await tx.researchRunStep.updateMany({
          where: {
            id: input.stepId,
            state: input.fromState as ResearchStepState,
            version: input.expectedVersion,
          },
          data,
        });

        if (updated.count === 0) {
          const current = await tx.researchRunStep.findUnique({
            where: { id: input.stepId },
          });
          if (current === null) {
            return { kind: 'not_found' as const };
          }
          return { kind: 'version_conflict' as const, step: this.toStep(current) };
        }

        if (input.outboxEvents !== undefined) {
          for (const event of input.outboxEvents) {
            await tx.outbox.create({
              data: {
                id: event.id,
                aggregateType: event.aggregateType,
                aggregateId: event.aggregateId,
                eventType: event.eventType,
                schemaVersion: event.schemaVersion,
                payload: event.payload as Prisma.InputJsonValue,
                correlationId: event.correlationId,
              },
            });
          }
        }

        const step = await tx.researchRunStep.findUniqueOrThrow({
          where: { id: input.stepId },
        });
        return { kind: 'applied' as const, step: this.toStep(step) };
      });
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }
      throw new L0OperationError('ResearchRun step transition failed', error);
    }
  }

  async transition(input: ResearchRunTransitionInput): Promise<ResearchRunTransitionResult> {
    if (!canTransitionResearchRun(input.fromState, input.toState)) {
      throw new ResearchRunTransitionError(input.fromState, input.toState);
    }

    await this.database.connect();
    try {
      return await this.client().$transaction(async (tx) => {
        if (input.useAdvisoryLock) {
          const lockKey = `research_run:${input.runId}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        }

        const now = new Date();
        const data: Prisma.ResearchRunUpdateManyMutationInput = {
          state: input.toState as ResearchRunState,
          version: { increment: 1 },
        };

        if (input.coverage !== undefined) {
          data.coverage = input.coverage as unknown as Prisma.InputJsonValue;
        }

        if (input.toState === 'RUNNING' && input.fromState === 'PLANNING') {
          data.startedAt = now;
        }

        if (isResearchRunTerminal(input.toState)) {
          data.terminalAt = now;
        }

        const updated = await tx.researchRun.updateMany({
          where: {
            id: input.runId,
            state: input.fromState as ResearchRunState,
            version: input.expectedVersion,
          },
          data,
        });

        if (updated.count === 0) {
          const current = await tx.researchRun.findUnique({ where: { id: input.runId } });
          if (current === null) {
            throw new L0OperationError('ResearchRun not found during transition', undefined);
          }
          return { kind: 'version_conflict', run: this.toRecord(current) };
        }

        if (input.cancelSteps === true && input.toState === 'CANCELLED') {
          await tx.researchRunStep.updateMany({
            where: {
              runId: input.runId,
              state: { in: CANCEL_STEP_FROM },
            },
            data: { state: 'CANCELLED', version: { increment: 1 } },
          });
        }

        if (input.toState === 'PAUSED_BUDGET' || input.toState === 'COMPLETING') {
          await tx.researchRunStep.updateMany({
            where: {
              runId: input.runId,
              state: { in: TERMINAL_STEP_DEFER_FROM },
            },
            data: { state: 'DEFERRED', version: { increment: 1 } },
          });
        }

        if (
          input.toState === 'RUNNING' &&
          (input.fromState === 'PAUSED_BUDGET' || input.fromState === 'PAUSED_MANUAL')
        ) {
          await tx.researchRunStep.updateMany({
            where: { runId: input.runId, state: 'DEFERRED' },
            data: { state: 'PENDING', version: { increment: 1 } },
          });
        }

        const outboxEventIds: string[] = [];
        for (const event of input.outboxEvents) {
          await tx.outbox.create({
            data: {
              id: event.id,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              eventType: event.eventType,
              schemaVersion: event.schemaVersion,
              payload: event.payload as Prisma.InputJsonValue,
              correlationId: event.correlationId,
            },
          });
          outboxEventIds.push(event.id);
        }

        const run = await tx.researchRun.findUniqueOrThrow({ where: { id: input.runId } });
        return { kind: 'applied', run: this.toRecord(run), outboxEventIds };
      });
    } catch (error) {
      if (error instanceof ResearchRunTransitionError || error instanceof L0OperationError) {
        throw error;
      }
      throw new L0OperationError('ResearchRun transition failed', error);
    }
  }

  async increaseReservedMicros(
    input: ResearchRunIncreaseBudgetInput,
  ): Promise<ResearchRunIncreaseBudgetResult> {
    if (typeof input.additionalMicros !== 'bigint' || input.additionalMicros <= 0n) {
      throw new L0OperationError(
        'additionalMicros must be a positive bigint',
        undefined,
      );
    }

    await this.database.connect();
    try {
      return await this.client().$transaction(async (tx) => {
        const updated = await tx.researchRun.updateMany({
          where: {
            id: input.runId,
            version: input.expectedVersion,
          },
          data: {
            reservedMicros: { increment: input.additionalMicros },
            version: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          const current = await tx.researchRun.findUnique({ where: { id: input.runId } });
          if (current === null) {
            return { kind: 'not_found' as const };
          }
          return { kind: 'version_conflict' as const, run: this.toRecord(current) };
        }

        const run = await tx.researchRun.findUniqueOrThrow({ where: { id: input.runId } });
        return { kind: 'applied' as const, run: this.toRecord(run) };
      });
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }
      throw new L0OperationError('ResearchRun budget increase failed', error);
    }
  }

  private toRecord(row: {
    id: string;
    orgId: string;
    projectId: string;
    preset: string;
    customDag: Prisma.JsonValue;
    state: ResearchRunState;
    version: number;
    reservedMicros: bigint;
    consumedMicros: bigint;
    coverage: Prisma.JsonValue;
    startedAt: Date | null;
    terminalAt: Date | null;
  }): ResearchRunRecord {
    if (!isResearchRunState(row.state)) {
      throw new L0OperationError(`Unknown ResearchRun state ${row.state}`, undefined);
    }
    if (!isResearchRunPreset(row.preset)) {
      throw new L0OperationError(`Unknown ResearchRun preset ${row.preset}`, undefined);
    }
    return {
      id: row.id,
      orgId: row.orgId,
      projectId: row.projectId,
      preset: row.preset as ResearchRunPresetName,
      customDag: row.customDag === null ? null : row.customDag,
      state: row.state as ResearchRunStateName,
      version: row.version,
      reservedMicros: row.reservedMicros,
      consumedMicros: row.consumedMicros,
      coverage: parseResearchRunCoverage(row.coverage) as ResearchRunCoverage,
      startedAt: row.startedAt,
      terminalAt: row.terminalAt,
    };
  }

  private toStep(row: {
    id: string;
    runId: string;
    stepType: string;
    dependsOnStepIds: string[];
    inputFingerprint: string;
    stepVersion: string;
    state: ResearchStepState;
    attemptCount: number;
    resultRef: string | null;
    version: number;
  }): ResearchRunStepRecord {
    if (!isResearchStepState(row.state)) {
      throw new L0OperationError(`Unknown ResearchRunStep state ${row.state}`, undefined);
    }
    return {
      id: row.id,
      runId: row.runId,
      stepType: row.stepType,
      dependsOnStepIds: row.dependsOnStepIds,
      inputFingerprint: row.inputFingerprint,
      stepVersion: row.stepVersion,
      state: row.state as ResearchStepStateName,
      attemptCount: row.attemptCount,
      resultRef: row.resultRef,
      version: row.version,
    };
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function countsFromGroups(
  rows: ReadonlyArray<{ state: ResearchStepState; _count: { _all: number } }>,
): ResearchRunStepCounts {
  const counts: Record<ResearchStepState, number> = {
    PENDING: 0,
    READY: 0,
    DISPATCHED: 0,
    RUNNING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    DEFERRED: 0,
    CANCELLED: 0,
  };
  for (const row of rows) {
    counts[row.state] = row._count._all;
  }
  return {
    ready: counts.READY,
    inFlight: counts.DISPATCHED + counts.RUNNING,
    pending: counts.PENDING,
    deferred: counts.DEFERRED,
    succeeded: counts.SUCCEEDED,
    failed: counts.FAILED,
    cancelled: counts.CANCELLED,
  };
}
