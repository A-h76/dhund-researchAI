import type {
  ChunkCommitInput,
  ChunkStore,
  ProjectChunk,
  StoredChunk,
} from '../../src/l0/ports/chunk-store.port';
import type { ProjectScope } from '../../src/l0/ports/scoped-store.port';
import type { OutboxInsertInput } from '../../src/l0/ports/outbox.port';
import type { DocumentLifecycleStatus } from '../../src/l0/ports/extract-store.port';
import {
  canTransitionDocument,
  DocumentTransitionError,
} from '../../src/l0/ports/document-state';
import type { MemoryExtractStore } from './memory-extract-store';

interface StoredChunkRow extends StoredChunk {
  readonly projectId: string;
  readonly page: number | null;
  readonly section: string | null;
}

/**
 * Mirrors PrismaChunkStoreAdapter: content-addressed inserts (unique on
 * documentVersionId + chunkerVersion + contentHash), transition-checked
 * status change, and outbox rows committed atomically. Intentionally offers
 * no update path for chunk text.
 */
export class MemoryChunkStore implements ChunkStore {
  readonly chunks: StoredChunkRow[] = [];
  readonly outbox: OutboxInsertInput[] = [];
  /** documentVersionId -> documentId, mirrors the DB relation. */
  readonly versionDocuments = new Map<string, string>();
  chunkLookups = 0;

  constructor(private readonly extractStore: MemoryExtractStore) {}

  linkVersion(documentVersionId: string, documentId: string): void {
    this.versionDocuments.set(documentVersionId, documentId);
  }

  async listChunks(
    documentVersionId: string,
    chunkerVersion: string,
  ): Promise<readonly StoredChunk[]> {
    return this.chunks
      .filter(
        (chunk) =>
          chunk.documentVersionId === documentVersionId &&
          chunk.chunkerVersion === chunkerVersion,
      )
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  async listPriorVersionHashes(
    documentId: string,
    documentVersionId: string,
    chunkerVersion: string,
  ): Promise<readonly string[]> {
    const hashes = new Set<string>();
    for (const chunk of this.chunks) {
      if (
        chunk.chunkerVersion === chunkerVersion &&
        chunk.documentVersionId !== documentVersionId &&
        this.versionDocuments.get(chunk.documentVersionId) === documentId
      ) {
        hashes.add(chunk.contentHash);
      }
    }
    return [...hashes];
  }

  async commitChunks(input: ChunkCommitInput): Promise<void> {
    // Validate the transition BEFORE mutating so the "transaction" is atomic.
    let nextStatus: DocumentLifecycleStatus | null = null;
    if (input.toStatus !== null) {
      const current = this.extractStore.documentStatus.get(input.documentId);
      if (current !== undefined) {
        if (!canTransitionDocument(current, input.toStatus)) {
          throw new DocumentTransitionError(current, input.toStatus);
        }
        nextStatus = input.toStatus;
      }
    }

    for (const chunk of input.chunks) {
      const duplicate = this.chunks.some(
        (row) =>
          row.documentVersionId === chunk.documentVersionId &&
          row.chunkerVersion === chunk.chunkerVersion &&
          row.contentHash === chunk.contentHash,
      );
      if (duplicate) {
        continue;
      }
      this.chunks.push({
        id: chunk.id,
        documentVersionId: chunk.documentVersionId,
        projectId: chunk.projectId,
        ordinal: chunk.ordinal,
        charSpan: chunk.charSpan,
        tokenCount: chunk.tokenCount,
        page: chunk.page,
        section: chunk.section,
        blockIds: chunk.blockIds,
        contentHash: chunk.contentHash,
        chunkerVersion: chunk.chunkerVersion,
        text: chunk.text,
      });
      this.versionDocuments.set(chunk.documentVersionId, input.documentId);
    }

    if (nextStatus !== null) {
      await this.extractStore.markDocumentStatus(input.documentId, nextStatus);
    }

    this.outbox.push(...input.outboxEvents);
  }

  eventsOfType(eventType: string): readonly OutboxInsertInput[] {
    return this.outbox.filter((event) => event.eventType === eventType);
  }

  async findInProject(
    scope: ProjectScope,
    chunkId: string,
  ): Promise<ProjectChunk | null> {
    this.chunkLookups += 1;
    const chunk = this.chunks.find(
      (row) => row.id === chunkId && row.projectId === scope.projectId,
    );
    if (chunk === undefined) {
      return null;
    }
    const documentId = this.versionDocuments.get(chunk.documentVersionId);
    if (documentId === undefined) {
      return null;
    }
    return {
      id: chunk.id,
      projectId: chunk.projectId,
      documentId,
      documentVersionId: chunk.documentVersionId,
      text: chunk.text,
      blockIds: chunk.blockIds,
      page: chunk.page,
    };
  }
}
