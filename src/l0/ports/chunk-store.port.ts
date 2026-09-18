import type { DocumentLifecycleStatus } from './extract-store.port';
import type { OutboxInsertInput } from './outbox.port';
import type { ProjectScope } from './scoped-store.port';

export interface ChunkCharSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * A derived, immutable retrieval projection of document_blocks.
 * `text` is written exactly once from authoritative blocks (DHB-52);
 * there is no update path for chunk text.
 */
export interface ChunkInsert {
  readonly id: string;
  readonly documentVersionId: string;
  readonly projectId: string;
  readonly ordinal: number;
  readonly charSpan: ChunkCharSpan;
  readonly tokenCount: number;
  readonly page: number | null;
  readonly section: string | null;
  readonly blockIds: readonly string[];
  readonly contentHash: string;
  readonly chunkerVersion: string;
  readonly text: string;
}

export interface StoredChunk {
  readonly id: string;
  readonly documentVersionId: string;
  readonly ordinal: number;
  readonly charSpan: ChunkCharSpan;
  readonly tokenCount: number;
  readonly blockIds: readonly string[];
  readonly contentHash: string;
  readonly chunkerVersion: string;
  readonly text: string;
}

/** Project-scoped chunk lookup for evidence writes (DHB-58). */
export interface ProjectChunk {
  readonly id: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly text: string;
  readonly blockIds: readonly string[];
  readonly page: number | null;
}

export interface ChunkCommitInput {
  readonly documentId: string;
  /** Only chunks that do not already exist for this version (content-addressed). */
  readonly chunks: readonly ChunkInsert[];
  /** Document status transition co-committed with the chunks; null keeps status. */
  readonly toStatus: DocumentLifecycleStatus | null;
  /** Outbox events committed in the SAME transaction as chunks and status. */
  readonly outboxEvents: readonly OutboxInsertInput[];
}

export interface ChunkStore {
  listChunks(
    documentVersionId: string,
    chunkerVersion: string,
  ): Promise<readonly StoredChunk[]>;
  /**
   * Content hashes already chunked on OTHER versions of the same document.
   * Used to skip re-embedding unchanged content on re-ingest.
   */
  listPriorVersionHashes(
    documentId: string,
    documentVersionId: string,
    chunkerVersion: string,
  ): Promise<readonly string[]>;
  /**
   * Single transaction: insert chunks, apply the document status transition,
   * append outbox events. Rolls back atomically. Throws DocumentTransitionError
   * when the requested transition is forbidden by the state machine.
   */
  commitChunks(input: ChunkCommitInput): Promise<void>;
  /**
   * Returns the chunk only when it belongs to `scope`. Cross-project ids
   * are indistinguishable from missing (no existence leak).
   */
  findInProject(
    scope: ProjectScope,
    chunkId: string,
  ): Promise<ProjectChunk | null>;
}
