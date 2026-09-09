import type { PdfBbox } from './pdf-parse.port';

export type ExtractBlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table_row'
  | 'table_cell'
  | 'figure'
  | 'caption'
  | 'equation'
  | 'reference';

export interface ExtractVersionRecord {
  readonly id: string;
  readonly documentId: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly storageKey: string;
  readonly documentStatus: string;
  readonly deletedAt: Date | null;
}

export interface ExtractBlockInput {
  readonly id: string;
  readonly type: ExtractBlockType;
  readonly page: number;
  readonly bbox: PdfBbox | null;
  readonly text: string;
  readonly ordinal: number;
}

export interface ExtractionRecord {
  readonly id: string;
  readonly documentVersionId: string;
  readonly extractorVersion: string;
  readonly contentHash: string;
  readonly status: string;
}

export interface StoredBlock {
  readonly id: string;
  readonly documentVersionId: string;
  readonly page: number;
  readonly ordinal: number;
  readonly text: string;
}

export type DocumentLifecycleStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled'
  | 'stale';

export interface ExtractStore {
  findVersion(documentVersionId: string): Promise<ExtractVersionRecord | null>;
  findExtraction(
    documentVersionId: string,
    extractorVersion: string,
    contentHash: string,
  ): Promise<ExtractionRecord | null>;
  insertExtractionWithBlocks(input: {
    readonly extractionId: string;
    readonly documentVersionId: string;
    readonly extractorVersion: string;
    readonly contentHash: string;
    readonly blocks: readonly ExtractBlockInput[];
  }): Promise<'created' | 'existing'>;
  markDocumentStatus(documentId: string, status: DocumentLifecycleStatus): Promise<void>;
  listBlocks(documentVersionId: string): Promise<readonly StoredBlock[]>;
  findBlock(blockId: string): Promise<StoredBlock | null>;
}
