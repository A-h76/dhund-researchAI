export type DocumentLifecycleStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled'
  | 'stale';

export type DocumentBlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table_row'
  | 'table_cell'
  | 'figure'
  | 'caption'
  | 'equation'
  | 'reference';

export interface DocumentVersionRecord {
  readonly id: string;
  readonly documentId: string;
  readonly storageKey: string;
  readonly versionNo: number;
  readonly document: {
    readonly id: string;
    readonly orgId: string;
    readonly projectId: string;
    readonly title: string;
    readonly status: DocumentLifecycleStatus;
  };
}

export interface DocumentExtractionRecord {
  readonly id: string;
  readonly documentVersionId: string;
  readonly extractorVersion: string;
  readonly contentHash: string;
  readonly status: string;
  readonly producedAt: Date;
}

export interface DocumentBlockRecord {
  readonly id: string;
  readonly documentVersionId: string;
  readonly type: DocumentBlockKind;
  readonly page: number;
  readonly bbox: unknown | null;
  readonly text: string;
  readonly ordinal: number;
  readonly parentBlockId: string | null;
}

export interface CreateBlockInput {
  readonly id: string;
  readonly type: DocumentBlockKind;
  readonly page: number;
  readonly text: string;
  readonly ordinal: number;
  readonly bbox?: unknown;
  readonly parentBlockId?: string;
}

export interface DocumentIngestionStore {
  getVersionWithDocument(documentVersionId: string): Promise<DocumentVersionRecord | null>;
  findExtraction(
    documentVersionId: string,
    extractorVersion: string,
    contentHash: string,
  ): Promise<DocumentExtractionRecord | null>;
  listBlocks(documentVersionId: string): Promise<readonly DocumentBlockRecord[]>;
  getBlock(blockId: string): Promise<DocumentBlockRecord | null>;
  createExtractionWithBlocks(input: {
    extractionId: string;
    documentVersionId: string;
    documentId: string;
    extractorVersion: string;
    contentHash: string;
    status: string;
    producedAt: Date;
    blocks: readonly CreateBlockInput[];
    documentStatus: DocumentLifecycleStatus;
  }): Promise<DocumentExtractionRecord>;
  markDocumentStatus(documentId: string, status: DocumentLifecycleStatus): Promise<void>;
}

export const DOCUMENT_INGESTION_STORE = Symbol('DOCUMENT_INGESTION_STORE');
