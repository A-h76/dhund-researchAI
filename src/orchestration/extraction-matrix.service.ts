import { Inject, Injectable } from '@nestjs/common';
import { assertDocumentReady } from '../ingestion/document-readiness';
import { DocumentsRepository } from '../ingestion/documents.repository';
import {
  EXTRACTION_MATRIX_STORE,
  emptyResearchRunCoverage,
  type ExtractionMatrixStore,
  type ExtractionRunRecord,
  type ExtractionSchemaRecord,
  type ResearchRunRecord,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids/uuid-v7';
import { JobEnqueueService } from '../platform/logging';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import {
  parseExtractionColumns,
  type ExtractionColumnDefinition,
} from './extraction-column-types';
import { ExtractionMatrixMetrics } from './extraction-matrix.metrics';

const MODULE = 'orchestration';
const DEFAULT_RESERVED_MICROS = 1_000_000n;

export interface CreateExtractionSchemaInput {
  readonly projectId: string;
  readonly name: string;
  readonly columns: unknown;
  readonly version?: number;
}

export interface CreateExtractionRunInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly initiatedBy: string;
  readonly schemaId: string;
  readonly documentIds: readonly string[];
  readonly idempotencyKey: string;
  readonly reservedMicros?: bigint;
  readonly correlationId: string;
}

export interface CreateExtractionRunResult {
  readonly researchRunId: string;
  readonly extractionRunId: string;
  readonly cellCount: number;
  readonly tickJobId: string;
}

@Injectable()
export class ExtractionMatrixService {
  constructor(
    @Inject(EXTRACTION_MATRIX_STORE) private readonly store: ExtractionMatrixStore,
    private readonly documents: DocumentsRepository,
    private readonly enqueue: JobEnqueueService,
    private readonly metrics: ExtractionMatrixMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async createSchema(input: CreateExtractionSchemaInput): Promise<ExtractionSchemaRecord> {
    const columns = parseExtractionColumns(input.columns);
    const schema = await this.store.createSchema({
      id: generateId(),
      projectId: input.projectId,
      name: input.name.trim(),
      columns,
      version: input.version ?? 1,
    });
    this.metrics.recordSchemaCreated();
    return {
      ...schema,
      columns,
    };
  }

  async createRun(input: CreateExtractionRunInput): Promise<CreateExtractionRunResult> {
    const schema = await this.requireSchema(input.projectId, input.schemaId);
    const columns = parseExtractionColumns(schema.columns);

    if (input.documentIds.length === 0) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'Extraction run requires at least one documentId.',
      });
    }

    const uniqueDocIds = uniqueStable(input.documentIds);
    for (const documentId of uniqueDocIds) {
      const document = await this.documents.get(
        { projectId: input.projectId },
        documentId,
      );
      // Cross-project → ScopedReader NotFound (404). Partial → document_not_ready.
      assertDocumentReady(String(document.status));
    }

    const researchRunId = generateId();
    const extractionRunId = generateId();
    const cells = uniqueDocIds.flatMap((documentId) =>
      columns.map((column) => ({
        id: generateId(),
        documentId,
        columnKey: column.key,
      })),
    );

    const { extractionRun, cellCount } = await this.store.createRunBundle({
      researchRun: {
        id: researchRunId,
        orgId: input.orgId,
        projectId: input.projectId,
        initiatedBy: input.initiatedBy,
        reservedMicros: input.reservedMicros ?? DEFAULT_RESERVED_MICROS,
        idempotencyKey: input.idempotencyKey,
        coverage: emptyResearchRunCoverage(),
      },
      extractionRun: {
        id: extractionRunId,
        schemaId: schema.id,
        schemaVersion: schema.version,
        documentIds: uniqueDocIds,
      },
      cells,
    });

    this.metrics.recordRunCreated(cellCount);
    this.logger.info({
      module: MODULE,
      message: 'extraction_run.bundle_created',
      researchRunId,
      extractionRunId: extractionRun.id,
      cellCount,
    });

    const tickJobId = await this.enqueue.enqueue('research-run-tick', {
      orgId: input.orgId,
      projectId: input.projectId,
      runId: researchRunId,
    });

    return {
      researchRunId,
      extractionRunId: extractionRun.id,
      cellCount,
      tickJobId,
    };
  }

  /**
   * Coordinator hook — enqueue extraction-cell jobs for pending cells.
   * Deterministic jobId makes duplicate dispatch safe.
   */
  async dispatchCellsForRun(run: ResearchRunRecord): Promise<number> {
    if (run.preset !== 'extraction_matrix') {
      return 0;
    }

    const extractionRun = await this.store.findRunByResearchRunId(run.id);
    if (extractionRun === null) {
      return 0;
    }

    if (extractionRun.state === 'pending') {
      await this.store.updateRunState(extractionRun.id, 'running');
    }

    const cells = await this.store.listCells(extractionRun.id);
    let enqueued = 0;
    for (const cell of cells) {
      if (cell.status !== 'pending' && cell.status !== 'running') {
        continue;
      }
      await this.enqueue.enqueue('extraction-cell', {
        orgId: run.orgId,
        projectId: run.projectId,
        runId: run.id,
        extractionRunId: extractionRun.id,
        documentId: cell.documentId,
        columnKey: cell.columnKey,
      });
      enqueued += 1;
    }
    return enqueued;
  }

  async areCellsTerminal(runId: string): Promise<boolean> {
    const extractionRun = await this.store.findRunByResearchRunId(runId);
    if (extractionRun === null) {
      return true;
    }
    const remaining = await this.store.countNonTerminalCells(extractionRun.id);
    return remaining === 0;
  }

  async finalizeExtractionRunIfReady(runId: string): Promise<void> {
    const extractionRun = await this.store.findRunByResearchRunId(runId);
    if (extractionRun === null) {
      return;
    }
    const remaining = await this.store.countNonTerminalCells(extractionRun.id);
    if (remaining > 0) {
      return;
    }
    const cells = await this.store.listCells(extractionRun.id);
    const anyFailed = cells.some((cell) => cell.status === 'failed');
    const state = anyFailed ? 'completed_partial' : 'completed';
    if (extractionRun.state !== state) {
      await this.store.updateRunState(extractionRun.id, state);
    }
  }

  async loadRunContext(input: {
    readonly projectId: string;
    readonly extractionRunId: string;
  }): Promise<{
    readonly extractionRun: ExtractionRunRecord;
    readonly columns: readonly ExtractionColumnDefinition[];
  }> {
    const extractionRun = await this.store.findRun(
      input.projectId,
      input.extractionRunId,
    );
    if (extractionRun === null) {
      throw new DomainError(ErrorCode.NotFound, {
        module: MODULE,
        userMessage: 'Extraction run not found.',
      });
    }
    const schema = await this.requireSchema(input.projectId, extractionRun.schemaId);
    return {
      extractionRun,
      columns: parseExtractionColumns(schema.columns),
    };
  }

  private async requireSchema(
    projectId: string,
    schemaId: string,
  ): Promise<ExtractionSchemaRecord> {
    const schema = await this.store.findSchema(projectId, schemaId);
    if (schema === null) {
      throw new DomainError(ErrorCode.NotFound, {
        module: MODULE,
        userMessage: 'Extraction schema not found.',
      });
    }
    return schema;
  }
}

function uniqueStable(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
