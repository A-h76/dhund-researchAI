export type ExtractionCellStatusName =
  | 'pending'
  | 'running'
  | 'ok'
  | 'failed'
  | 'skipped';

export type ExtractionRunStateName =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_partial'
  | 'failed'
  | 'cancelled';

export interface ExtractionSchemaRecord {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  /** Typed at the orchestration boundary via parseExtractionColumns. */
  readonly columns: unknown;
  readonly version: number;
  readonly createdAt: Date;
}

export interface ExtractionRunRecord {
  readonly id: string;
  readonly runId: string;
  readonly schemaId: string;
  readonly schemaVersion: number;
  readonly documentIds: readonly string[];
  readonly state: ExtractionRunStateName;
  readonly createdAt: Date;
}

export interface ExtractionCellRecord {
  readonly id: string;
  readonly extractionRunId: string;
  readonly documentId: string;
  readonly columnKey: string;
  readonly value: unknown | null;
  readonly evidenceLocator: unknown | null;
  readonly aiExecutionId: string | null;
  readonly confidence: string | null;
  readonly method: 'deterministic' | 'llm' | 'human';
  readonly status: ExtractionCellStatusName;
}

export interface CreateExtractionSchemaInput {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly columns: unknown;
  readonly version: number;
}

export interface CreateExtractionRunBundleInput {
  readonly researchRun: {
    readonly id: string;
    readonly orgId: string;
    readonly projectId: string;
    readonly initiatedBy: string;
    readonly reservedMicros: bigint;
    readonly idempotencyKey: string;
    readonly coverage: unknown;
  };
  readonly extractionRun: {
    readonly id: string;
    readonly schemaId: string;
    readonly schemaVersion: number;
    readonly documentIds: readonly string[];
  };
  readonly cells: readonly {
    readonly id: string;
    readonly documentId: string;
    readonly columnKey: string;
  }[];
}

export interface ExtractionMatrixStore {
  createSchema(input: CreateExtractionSchemaInput): Promise<ExtractionSchemaRecord>;
  findSchema(projectId: string, schemaId: string): Promise<ExtractionSchemaRecord | null>;
  createRunBundle(input: CreateExtractionRunBundleInput): Promise<{
    readonly extractionRun: ExtractionRunRecord;
    readonly cellCount: number;
  }>;
  findRunByResearchRunId(runId: string): Promise<ExtractionRunRecord | null>;
  findRun(projectId: string, extractionRunId: string): Promise<ExtractionRunRecord | null>;
  updateRunState(
    extractionRunId: string,
    state: ExtractionRunStateName,
  ): Promise<ExtractionRunRecord>;
  listCells(extractionRunId: string): Promise<readonly ExtractionCellRecord[]>;
  findCell(input: {
    readonly extractionRunId: string;
    readonly documentId: string;
    readonly columnKey: string;
  }): Promise<ExtractionCellRecord | null>;
  updateCell(
    cellId: string,
    patch: {
      readonly status?: ExtractionCellStatusName;
      readonly value?: unknown | null;
      readonly evidenceLocator?: unknown | null;
      readonly aiExecutionId?: string | null;
      readonly method?: 'deterministic' | 'llm' | 'human';
      readonly confidence?: string | null;
    },
  ): Promise<ExtractionCellRecord>;
  countNonTerminalCells(extractionRunId: string): Promise<number>;
}
