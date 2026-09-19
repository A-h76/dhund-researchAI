import { Injectable } from '@nestjs/common';
import {
  ExtractionCellStatus,
  ExtractionMethod,
  ExtractionRunState,
  Prisma,
} from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  CreateExtractionRunBundleInput,
  CreateExtractionSchemaInput,
  ExtractionCellRecord,
  ExtractionCellStatusName,
  ExtractionMatrixStore,
  ExtractionRunRecord,
  ExtractionRunStateName,
  ExtractionSchemaRecord,
} from '../../ports/extraction-matrix.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaExtractionMatrixAdapter implements ExtractionMatrixStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async createSchema(input: CreateExtractionSchemaInput): Promise<ExtractionSchemaRecord> {
    await this.database.connect();
    try {
      const row = await this.client().extractionSchema.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          name: input.name,
          columns: input.columns as unknown as Prisma.InputJsonValue,
          version: input.version,
        },
      });
      return toSchema(row);
    } catch (error) {
      throw new L0OperationError('Extraction schema create failed', error);
    }
  }

  async findSchema(
    projectId: string,
    schemaId: string,
  ): Promise<ExtractionSchemaRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().extractionSchema.findFirst({
        where: { id: schemaId, projectId },
      });
      return row === null ? null : toSchema(row);
    } catch (error) {
      throw new L0OperationError('Extraction schema lookup failed', error);
    }
  }

  async createRunBundle(input: CreateExtractionRunBundleInput): Promise<{
    readonly extractionRun: ExtractionRunRecord;
    readonly cellCount: number;
  }> {
    await this.database.connect();
    try {
      return await this.client().$transaction(async (tx) => {
        await tx.researchRun.create({
          data: {
            id: input.researchRun.id,
            orgId: input.researchRun.orgId,
            projectId: input.researchRun.projectId,
            initiatedBy: input.researchRun.initiatedBy,
            preset: 'extraction_matrix',
            reservedMicros: input.researchRun.reservedMicros,
            idempotencyKey: input.researchRun.idempotencyKey,
            coverage: input.researchRun.coverage as Prisma.InputJsonValue,
          },
        });

        const run = await tx.extractionRun.create({
          data: {
            id: input.extractionRun.id,
            runId: input.researchRun.id,
            schemaId: input.extractionRun.schemaId,
            schemaVersion: input.extractionRun.schemaVersion,
            documentIds: [...input.extractionRun.documentIds],
            state: ExtractionRunState.pending,
          },
        });

        if (input.cells.length > 0) {
          // Pending rows use deterministic until LLM succeeds (chk: llm ⇒ ai_execution_id).
          await tx.extractionCell.createMany({
            data: input.cells.map((cell) => ({
              id: cell.id,
              extractionRunId: input.extractionRun.id,
              documentId: cell.documentId,
              columnKey: cell.columnKey,
              method: ExtractionMethod.deterministic,
              status: ExtractionCellStatus.pending,
            })),
          });
        }

        return {
          extractionRun: toRun(run),
          cellCount: input.cells.length,
        };
      });
    } catch (error) {
      throw new L0OperationError('Extraction run bundle create failed', error);
    }
  }

  async findRunByResearchRunId(runId: string): Promise<ExtractionRunRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().extractionRun.findUnique({ where: { runId } });
      return row === null ? null : toRun(row);
    } catch (error) {
      throw new L0OperationError('Extraction run lookup by research run failed', error);
    }
  }

  async findRun(
    projectId: string,
    extractionRunId: string,
  ): Promise<ExtractionRunRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().extractionRun.findFirst({
        where: {
          id: extractionRunId,
          researchRun: { projectId },
        },
      });
      return row === null ? null : toRun(row);
    } catch (error) {
      throw new L0OperationError('Extraction run lookup failed', error);
    }
  }

  async updateRunState(
    extractionRunId: string,
    state: ExtractionRunStateName,
  ): Promise<ExtractionRunRecord> {
    await this.database.connect();
    try {
      const row = await this.client().extractionRun.update({
        where: { id: extractionRunId },
        data: { state: toPrismaRunState(state) },
      });
      return toRun(row);
    } catch (error) {
      throw new L0OperationError('Extraction run state update failed', error);
    }
  }

  async listCells(extractionRunId: string): Promise<readonly ExtractionCellRecord[]> {
    await this.database.connect();
    try {
      const rows = await this.client().extractionCell.findMany({
        where: { extractionRunId },
        orderBy: [{ documentId: 'asc' }, { columnKey: 'asc' }],
      });
      return rows.map(toCell);
    } catch (error) {
      throw new L0OperationError('Extraction cell list failed', error);
    }
  }

  async findCell(input: {
    readonly extractionRunId: string;
    readonly documentId: string;
    readonly columnKey: string;
  }): Promise<ExtractionCellRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().extractionCell.findUnique({
        where: {
          extractionRunId_documentId_columnKey: {
            extractionRunId: input.extractionRunId,
            documentId: input.documentId,
            columnKey: input.columnKey,
          },
        },
      });
      return row === null ? null : toCell(row);
    } catch (error) {
      throw new L0OperationError('Extraction cell lookup failed', error);
    }
  }

  async updateCell(
    cellId: string,
    patch: {
      readonly status?: ExtractionCellStatusName;
      readonly value?: unknown | null;
      readonly evidenceLocator?: unknown | null;
      readonly aiExecutionId?: string | null;
      readonly method?: 'deterministic' | 'llm' | 'human';
      readonly confidence?: string | null;
    },
  ): Promise<ExtractionCellRecord> {
    await this.database.connect();
    try {
      const data: Prisma.ExtractionCellUpdateInput = {};
      if (patch.status !== undefined) {
        data.status = toPrismaCellStatus(patch.status);
      }
      if (patch.value !== undefined) {
        data.value =
          patch.value === null
            ? Prisma.DbNull
            : (patch.value as Prisma.InputJsonValue);
      }
      if (patch.evidenceLocator !== undefined) {
        data.evidenceLocator =
          patch.evidenceLocator === null
            ? Prisma.DbNull
            : (patch.evidenceLocator as Prisma.InputJsonValue);
      }
      if (patch.aiExecutionId !== undefined) {
        data.aiExecution =
          patch.aiExecutionId === null
            ? { disconnect: true }
            : { connect: { id: patch.aiExecutionId } };
      }
      if (patch.method !== undefined) {
        data.method = patch.method;
      }
      if (patch.confidence !== undefined) {
        data.confidence =
          patch.confidence === null ? null : new Prisma.Decimal(patch.confidence);
      }
      const row = await this.client().extractionCell.update({
        where: { id: cellId },
        data,
      });
      return toCell(row);
    } catch (error) {
      throw new L0OperationError('Extraction cell update failed', error);
    }
  }

  async countNonTerminalCells(extractionRunId: string): Promise<number> {
    await this.database.connect();
    try {
      return await this.client().extractionCell.count({
        where: {
          extractionRunId,
          status: {
            in: [ExtractionCellStatus.pending, ExtractionCellStatus.running],
          },
        },
      });
    } catch (error) {
      throw new L0OperationError('Extraction cell count failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function toSchema(row: {
  id: string;
  projectId: string;
  name: string;
  columns: unknown;
  version: number;
  createdAt: Date;
}): ExtractionSchemaRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    columns: row.columns,
    version: row.version,
    createdAt: row.createdAt,
  };
}

function toRun(row: {
  id: string;
  runId: string;
  schemaId: string;
  schemaVersion: number;
  documentIds: string[];
  state: ExtractionRunState;
  createdAt: Date;
}): ExtractionRunRecord {
  return {
    id: row.id,
    runId: row.runId,
    schemaId: row.schemaId,
    schemaVersion: row.schemaVersion,
    documentIds: row.documentIds,
    state: row.state,
    createdAt: row.createdAt,
  };
}

function toCell(row: {
  id: string;
  extractionRunId: string;
  documentId: string;
  columnKey: string;
  value: unknown;
  evidenceLocator: unknown;
  aiExecutionId: string | null;
  confidence: Prisma.Decimal | null;
  method: ExtractionMethod;
  status: ExtractionCellStatus;
}): ExtractionCellRecord {
  return {
    id: row.id,
    extractionRunId: row.extractionRunId,
    documentId: row.documentId,
    columnKey: row.columnKey,
    value: row.value,
    evidenceLocator: row.evidenceLocator,
    aiExecutionId: row.aiExecutionId,
    confidence: row.confidence === null ? null : row.confidence.toString(),
    method: row.method,
    status: row.status,
  };
}

function toPrismaRunState(state: ExtractionRunStateName): ExtractionRunState {
  switch (state) {
    case 'pending':
      return ExtractionRunState.pending;
    case 'running':
      return ExtractionRunState.running;
    case 'completed':
      return ExtractionRunState.completed;
    case 'completed_partial':
      return ExtractionRunState.completed_partial;
    case 'failed':
      return ExtractionRunState.failed;
    case 'cancelled':
      return ExtractionRunState.cancelled;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function toPrismaCellStatus(status: ExtractionCellStatusName): ExtractionCellStatus {
  switch (status) {
    case 'pending':
      return ExtractionCellStatus.pending;
    case 'running':
      return ExtractionCellStatus.running;
    case 'ok':
      return ExtractionCellStatus.ok;
    case 'failed':
      return ExtractionCellStatus.failed;
    case 'skipped':
      return ExtractionCellStatus.skipped;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
