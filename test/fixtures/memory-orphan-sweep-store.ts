import type {
  LiveDocumentRecord,
  NewDocumentVersionInput,
  OrphanSweepStore,
  OwnedStorageKeysResult,
} from '../../src/l0/ports/orphan-sweep-store.port';

interface StoredVersion {
  readonly id: string;
  readonly documentId: string;
  readonly versionNo: number;
  readonly storageKey: string;
  retiredAt: Date | null;
}

interface StoredChunk {
  readonly id: string;
  readonly documentVersionId: string;
}

interface StoredEmbedding {
  readonly id: string;
  readonly chunkId: string;
}

interface StoredSession {
  readonly storageKey: string;
  readonly status: string;
  readonly expiresAt: Date;
}

interface StoredDocument {
  readonly record: LiveDocumentRecord;
  deletedAt: Date | null;
}

export class MemoryOrphanSweepStore implements OrphanSweepStore {
  readonly documents = new Map<string, StoredDocument>();
  readonly versions: StoredVersion[] = [];
  readonly chunks: StoredChunk[] = [];
  readonly embeddings: StoredEmbedding[] = [];
  readonly sessions: StoredSession[] = [];
  failOwnedQuery = false;

  seedLive(record: LiveDocumentRecord): void {
    this.documents.set(record.id, { record, deletedAt: null });
  }

  seedVersion(input: NewDocumentVersionInput): void {
    this.versions.push({
      id: input.id,
      documentId: input.documentId,
      versionNo: input.versionNo,
      storageKey: input.storageKey,
      retiredAt: null,
    });
  }

  seedSession(session: StoredSession): void {
    this.sessions.push(session);
  }

  seedChunk(chunk: StoredChunk, embeddingId?: string): void {
    this.chunks.push(chunk);
    if (embeddingId !== undefined) {
      this.embeddings.push({ id: embeddingId, chunkId: chunk.id });
    }
  }

  tombstone(id: string): void {
    const row = this.documents.get(id);
    if (row === undefined) {
      return;
    }
    row.deletedAt = new Date();
  }

  async findLiveById(id: string): Promise<LiveDocumentRecord | null> {
    const row = this.documents.get(id);
    if (row === undefined || row.deletedAt !== null) {
      return null;
    }
    return row.record;
  }

  async listOwnedStorageKeys(): Promise<OwnedStorageKeysResult> {
    if (this.failOwnedQuery) {
      return { ok: false };
    }
    const keys = new Set<string>();
    const now = Date.now();
    for (const row of this.documents.values()) {
      if (row.deletedAt === null) {
        keys.add(row.record.storageKey);
      }
    }
    for (const version of this.versions) {
      const document = this.documents.get(version.documentId);
      if (document !== undefined && document.deletedAt === null) {
        keys.add(version.storageKey);
      }
    }
    for (const session of this.sessions) {
      if (
        (session.status === 'issued' || session.status === 'uploaded') &&
        session.expiresAt.getTime() > now
      ) {
        keys.add(session.storageKey);
      }
    }
    return { ok: true, keys };
  }

  async retireVersion(versionId: string): Promise<boolean> {
    const version = this.versions.find((row) => row.id === versionId);
    if (version === undefined || version.retiredAt !== null) {
      return false;
    }
    version.retiredAt = new Date();
    return true;
  }

  async addVersion(input: NewDocumentVersionInput): Promise<void> {
    this.versions.push({
      id: input.id,
      documentId: input.documentId,
      versionNo: input.versionNo,
      storageKey: input.storageKey,
      retiredAt: null,
    });
  }

  async countChunksForDocument(documentId: string): Promise<number> {
    const versionIds = new Set(
      this.versions.filter((row) => row.documentId === documentId).map((row) => row.id),
    );
    return this.chunks.filter((row) => versionIds.has(row.documentVersionId)).length;
  }

  async countEmbeddingsForDocument(documentId: string): Promise<number> {
    const versionIds = new Set(
      this.versions.filter((row) => row.documentId === documentId).map((row) => row.id),
    );
    const chunkIds = new Set(
      this.chunks
        .filter((row) => versionIds.has(row.documentVersionId))
        .map((row) => row.id),
    );
    return this.embeddings.filter((row) => chunkIds.has(row.chunkId)).length;
  }
}
