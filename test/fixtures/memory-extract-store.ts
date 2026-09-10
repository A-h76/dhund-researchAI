import type {
  DocumentLifecycleStatus,
  ExtractBlockInput,
  ExtractStore,
  ExtractVersionRecord,
  ExtractionRecord,
  StoredBlock,
} from '../../src/l0/ports/extract-store.port';
import {
  canTransitionDocument,
  DocumentTransitionError,
} from '../../src/l0/ports/document-state';

export class MemoryExtractStore implements ExtractStore {
  readonly versions = new Map<string, ExtractVersionRecord>();
  readonly extractions: ExtractionRecord[] = [];
  readonly blocks: StoredBlock[] = [];
  readonly documentStatus = new Map<string, DocumentLifecycleStatus>();

  seedVersion(record: ExtractVersionRecord): void {
    this.versions.set(record.id, record);
    this.documentStatus.set(record.documentId, record.documentStatus as DocumentLifecycleStatus);
  }

  async findVersion(documentVersionId: string): Promise<ExtractVersionRecord | null> {
    return this.versions.get(documentVersionId) ?? null;
  }

  async findExtraction(
    documentVersionId: string,
    extractorVersion: string,
    contentHash: string,
  ): Promise<ExtractionRecord | null> {
    return (
      this.extractions.find(
        (row) =>
          row.documentVersionId === documentVersionId &&
          row.extractorVersion === extractorVersion &&
          row.contentHash === contentHash,
      ) ?? null
    );
  }

  async insertExtractionWithBlocks(input: {
    readonly extractionId: string;
    readonly documentVersionId: string;
    readonly extractorVersion: string;
    readonly contentHash: string;
    readonly blocks: readonly ExtractBlockInput[];
  }): Promise<'created' | 'existing'> {
    const existing = await this.findExtraction(
      input.documentVersionId,
      input.extractorVersion,
      input.contentHash,
    );
    if (existing !== null) {
      return 'existing';
    }
    this.extractions.push({
      id: input.extractionId,
      documentVersionId: input.documentVersionId,
      extractorVersion: input.extractorVersion,
      contentHash: input.contentHash,
      status: 'ok',
    });
    for (const block of input.blocks) {
      this.blocks.push({
        id: block.id,
        documentVersionId: input.documentVersionId,
        page: block.page,
        ordinal: block.ordinal,
        text: block.text,
      });
    }
    return 'created';
  }

  async markDocumentStatus(documentId: string, status: DocumentLifecycleStatus): Promise<void> {
    const current = this.documentStatus.get(documentId);
    if (current !== undefined && !canTransitionDocument(current, status)) {
      throw new DocumentTransitionError(current, status);
    }
    this.documentStatus.set(documentId, status);
    for (const [id, version] of this.versions) {
      if (version.documentId === documentId) {
        this.versions.set(id, { ...version, documentStatus: status });
      }
    }
  }

  async listBlocks(documentVersionId: string): Promise<readonly StoredBlock[]> {
    return this.blocks
      .filter((row) => row.documentVersionId === documentVersionId)
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  async findBlock(blockId: string): Promise<StoredBlock | null> {
    return this.blocks.find((row) => row.id === blockId) ?? null;
  }
}
