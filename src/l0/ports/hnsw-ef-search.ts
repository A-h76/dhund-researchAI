import {
  HNSW_EF_SEARCH_DEFAULT,
  HNSW_EF_SEARCH_MAX,
  HNSW_EF_SEARCH_MIN,
} from './hnsw.constants';
import {
  EMBEDDING_VECTOR_DIMENSION,
  EmbeddingDimensionMismatchError,
} from './embedding-store.port';

export class InvalidHnswEfSearchError extends Error {
  constructor(readonly value: number) {
    super(
      `hnsw.ef_search must be an integer between ${HNSW_EF_SEARCH_MIN} and ${HNSW_EF_SEARCH_MAX}`,
    );
    this.name = 'InvalidHnswEfSearchError';
  }
}

export function resolveHnswEfSearch(value: number = HNSW_EF_SEARCH_DEFAULT): number {
  if (!Number.isInteger(value) || value < HNSW_EF_SEARCH_MIN || value > HNSW_EF_SEARCH_MAX) {
    throw new InvalidHnswEfSearchError(value);
  }
  return value;
}

/** Query-time twin of the write-time dimension check — never truncate or recast. */
export function assertQueryVectorDimension(vectorLiteral: string): void {
  const dimension = countVectorDimensions(vectorLiteral);
  if (dimension !== EMBEDDING_VECTOR_DIMENSION) {
    throw new EmbeddingDimensionMismatchError('query', dimension);
  }
}

export function countVectorDimensions(vectorLiteral: string): number {
  const trimmed = vectorLiteral.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return 0;
  }
  const body = trimmed.slice(1, -1).trim();
  if (body.length === 0) {
    return 0;
  }
  return body.split(',').length;
}
