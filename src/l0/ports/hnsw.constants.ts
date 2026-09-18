/**
 * GAP-HNSW-01 — the sole vector index. Created by DHB-30 migration 010.
 * DHB-54 consumes it; it must never be recreated or given a per-project twin.
 */
export const HNSW_INDEX_NAME = 'idx_chunk_embeddings_hnsw_embedding_v1' as const;
export const HNSW_OPERATOR_CLASS = 'vector_cosine_ops' as const;
export const HNSW_M = 16 as const;
export const HNSW_EF_CONSTRUCTION = 128 as const;
/** Runtime search-list size. SET LOCAL — not an index rebuild. */
export const HNSW_EF_SEARCH_DEFAULT = 80 as const;
export const HNSW_EF_SEARCH_MIN = 1 as const;
export const HNSW_EF_SEARCH_MAX = 400 as const;

/**
 * Partial-index predicate (migration 010). ANN queries must match this so they
 * ride the existing index rather than a sequential scan of other versions.
 */
export const HNSW_WRITE_ACTIVE_MODEL_VERSION = 'embedding_v1' as const;

/** Indexes DHB-54 consumes and must not recreate. */
export const CONSUMED_SEARCH_INDEXES = [
  HNSW_INDEX_NAME,
  'idx_chunks_fts',
  'idx_documents_title_trgm',
  'idx_documents_authors_trgm',
  'idx_canonical_works_title_trgm',
] as const;
