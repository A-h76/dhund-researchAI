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
  readonly versionNo?: number;
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

/**
 * Body-storage rights for a document (DHB-58 PX-b).
 * User-uploaded docs with no rights snapshot are unrestricted.
 */
export type DocumentBodyCapability = 'unrestricted' | 'allowed' | 'forbidden';

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
  /**
   * Rights for body storage. Does not load block or chunk text.
   * Returns null when the document is missing or soft-deleted.
   */
  bodyCapability(documentId: string): Promise<DocumentBodyCapability | null>;
}
