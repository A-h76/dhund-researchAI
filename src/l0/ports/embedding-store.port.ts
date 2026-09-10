/**
 * Width of the `chunk_embeddings.vector` column (migration 010). The dimension
 * is schema-bound: `vector(1024)` plus `chk_chunk_embeddings_dimensions`. A
 * mismatch is a failed write, never a truncated or padded row.
 */
export const EMBEDDING_VECTOR_DIMENSION = 1024;

export interface EmbeddableChunk {
  readonly chunkId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly contentHash: string;
  readonly text: string;
}

export interface EmbeddingInsert {
  readonly id: string;
  readonly chunkId: string;
  readonly projectId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly vector: readonly number[];
  readonly contentHash: string;
}

/** Identity of a stored embedding under the (chunk, version, content) unique key. */
export interface EmbeddingKey {
  readonly chunkId: string;
  readonly contentHash: string;
}

export interface EmbeddingScopeQuery {
  readonly orgId: string;
  /** null means every project in the org (allProjects). */
  readonly projectIds: readonly string[] | null;
  /** null means every document in the selected projects. */
  readonly documentIds: readonly string[] | null;
  readonly afterChunkId: string | null;
  readonly limit: number;
}

export class EmbeddingDimensionMismatchError extends Error {
  constructor(
    readonly chunkId: string,
    readonly actual: number,
  ) {
    super(
      `Embedding for chunk ${chunkId} has ${actual} dimensions, expected ${EMBEDDING_VECTOR_DIMENSION}`,
    );
    this.name = 'EmbeddingDimensionMismatchError';
  }
}

export interface EmbeddingStore {
  findChunk(chunkId: string): Promise<EmbeddableChunk | null>;
  /** Ordered by chunk id so `afterChunkId` pages a backfill deterministically. */
  listChunksInScope(query: EmbeddingScopeQuery): Promise<readonly EmbeddableChunk[]>;
  listEmbeddedKeys(
    modelVersion: string,
    chunkIds: readonly string[],
  ): Promise<readonly EmbeddingKey[]>;
  /**
   * Inserts with ON CONFLICT DO NOTHING on
   * (chunk_id, model_version, content_hash) and returns the rows actually
   * written, so a re-run reports zero. Throws EmbeddingDimensionMismatchError
   * before touching the database when any vector is not the schema width.
   */
  insertEmbeddings(rows: readonly EmbeddingInsert[]): Promise<number>;
}

export function embeddingKeyOf(chunkId: string, contentHash: string): string {
  return `${chunkId}:${contentHash}`;
}
