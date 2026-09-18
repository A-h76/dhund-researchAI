import type { ProjectScope } from './scoped-store.port';

export type RetrievalArm = 'vector' | 'fts';

export interface FtsHit {
  readonly chunkId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly text?: string;
}

export interface FtsSearchInput {
  readonly scope: ProjectScope;
  readonly query: string;
  readonly limit: number;
}

export class RetrievalArmUnavailableError extends Error {
  constructor(
    readonly arm: RetrievalArm,
    readonly cause?: unknown,
  ) {
    super(`${arm} retrieval arm unavailable`);
    this.name = 'RetrievalArmUnavailableError';
  }
}

/**
 * Lexical arm over DHB-31 `idx_chunks_fts`. Vector ANN stays on ScopedStore so
 * there is still exactly one HNSW consumer path.
 */
export interface RetrievalIndexStore {
  ftsSearch(input: FtsSearchInput): Promise<readonly FtsHit[]>;
  /**
   * Applies SET LOCAL hnsw.ef_search on a transaction and reads it back.
   * Proves the setting is runtime-tunable without a migration.
   */
  readHnswEfSearch(efSearch: number): Promise<number>;
}
