import {
  EMBEDDING_VECTOR_DIMENSION,
  EmbeddingDimensionMismatchError,
  type EmbeddableChunk,
  type EmbeddingInsert,
  type EmbeddingKey,
  type EmbeddingScopeQuery,
  type EmbeddingStore,
} from '../../src/l0/ports/embedding-store.port';

interface StoredEmbeddingRow extends EmbeddingInsert {
  readonly dimensions: number;
  readonly status: 'ok';
}

interface SeededChunk extends EmbeddableChunk {
  readonly orgId: string;
}

/**
 * Mirrors PrismaEmbeddingStoreAdapter: dimension refused before the write,
 * ON CONFLICT DO NOTHING on (chunkId, modelVersion, contentHash), and no
 * update path so two model versions coexist on the unique key.
 */
export class MemoryEmbeddingStore implements EmbeddingStore {
  readonly chunks: SeededChunk[] = [];
  readonly embeddings: StoredEmbeddingRow[] = [];

  seedChunk(chunk: SeededChunk): void {
    this.chunks.push(chunk);
  }

  async findChunk(chunkId: string): Promise<EmbeddableChunk | null> {
    return this.chunks.find((chunk) => chunk.chunkId === chunkId) ?? null;
  }

  async listChunksInScope(query: EmbeddingScopeQuery): Promise<readonly EmbeddableChunk[]> {
    return this.chunks
      .filter((chunk) => chunk.orgId === query.orgId)
      .filter(
        (chunk) => query.projectIds === null || query.projectIds.includes(chunk.projectId),
      )
      .filter(
        (chunk) => query.documentIds === null || query.documentIds.includes(chunk.documentId),
      )
      .sort((a, b) => a.chunkId.localeCompare(b.chunkId))
      .filter(
        (chunk) => query.afterChunkId === null || chunk.chunkId > query.afterChunkId,
      )
      .slice(0, query.limit);
  }

  async listEmbeddedKeys(
    modelVersion: string,
    chunkIds: readonly string[],
  ): Promise<readonly EmbeddingKey[]> {
    return this.embeddings
      .filter((row) => row.modelVersion === modelVersion && chunkIds.includes(row.chunkId))
      .map((row) => ({ chunkId: row.chunkId, contentHash: row.contentHash }));
  }

  async insertEmbeddings(rows: readonly EmbeddingInsert[]): Promise<number> {
    for (const row of rows) {
      if (row.vector.length !== EMBEDDING_VECTOR_DIMENSION) {
        throw new EmbeddingDimensionMismatchError(row.chunkId, row.vector.length);
      }
    }

    let inserted = 0;
    for (const row of rows) {
      const duplicate = this.embeddings.some(
        (existing) =>
          existing.chunkId === row.chunkId &&
          existing.modelVersion === row.modelVersion &&
          existing.contentHash === row.contentHash,
      );
      if (duplicate) {
        continue;
      }
      this.embeddings.push({ ...row, dimensions: row.vector.length, status: 'ok' });
      inserted += 1;
    }
    return inserted;
  }
}
