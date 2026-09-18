import { resolveHnswEfSearch } from '../../src/l0/ports/hnsw-ef-search';
import type {
  FtsHit,
  FtsSearchInput,
  RetrievalIndexStore,
} from '../../src/l0/ports/retrieval-index.port';

export interface MemoryFtsChunk {
  readonly chunkId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly text: string;
}

export class MemoryRetrievalIndexStore implements RetrievalIndexStore {
  chunks: MemoryFtsChunk[] = [];
  ftsUnavailable = false;
  lastEfSearch: number | null = null;
  lastLimit: number | undefined;

  ftsSearch(input: FtsSearchInput): Promise<readonly FtsHit[]> {
    if (this.ftsUnavailable) {
      return Promise.reject(new Error('fts down'));
    }
    this.lastLimit = input.limit;
    const needle = input.query.toLowerCase();
    const hits = this.chunks
      .filter(
        (chunk) =>
          chunk.projectId === input.scope.projectId &&
          chunk.text.toLowerCase().includes(needle),
      )
      .slice(0, input.limit)
      .map((chunk) => ({
        chunkId: chunk.chunkId,
        projectId: chunk.projectId,
        documentId: chunk.documentId,
        text: chunk.text,
        ftsScore: 1,
      }));
    return Promise.resolve(hits);
  }

  readHnswEfSearch(efSearch: number): Promise<number> {
    const resolved = resolveHnswEfSearch(efSearch);
    this.lastEfSearch = resolved;
    return Promise.resolve(resolved);
  }
}
