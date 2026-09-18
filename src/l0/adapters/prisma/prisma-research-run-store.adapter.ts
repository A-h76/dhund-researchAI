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
import type {
  ResearchRunRecord,
  ResearchRunStepCounts,
  ResearchRunStore,
  ResearchRunTransitionInput,
  ResearchRunTransitionResult,
} from '../../ports/research-run-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

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
    } catch (error) {
      throw new L0OperationError('ResearchRun step count failed', error);
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
              state: { in: ['PENDING', 'READY', 'DISPATCHED', 'RUNNING', 'DEFERRED', 'FAILED'] },
            },
            data: { state: 'CANCELLED', version: { increment: 1 } },
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

  private toRecord(row: {
    id: string;
    orgId: string;
    projectId: string;
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
    return {
      id: row.id,
      orgId: row.orgId,
      projectId: row.projectId,
      state: row.state as ResearchRunStateName,
      version: row.version,
      reservedMicros: row.reservedMicros,
      consumedMicros: row.consumedMicros,
      coverage: parseResearchRunCoverage(row.coverage) as ResearchRunCoverage,
      startedAt: row.startedAt,
      terminalAt: row.terminalAt,
    };
  }

  private client() {
    return this.database.getPrismaClient();
  }
}
