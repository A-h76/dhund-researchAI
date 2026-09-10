import type { ProjectScope } from './scoped-store.port';

export interface RetrievalTracePersistInput {
  readonly id: string;
  readonly projectId: string;
  readonly queryFingerprint: string;
  readonly embeddingModel: string;
  readonly embeddingVersion: string;
  readonly k: number;
  readonly overFetchFactor: number;
  readonly efSearch: number;
  readonly fallbacksUsed: readonly string[];
  readonly body: Record<string, unknown>;
}

export interface StoredRetrievalTrace {
  readonly id: string;
  readonly projectId: string;
  readonly queryFingerprint: string;
  readonly embeddingModel: string;
  readonly embeddingVersion: string;
  readonly k: number;
  readonly overFetchFactor: number;
  readonly efSearch: number;
  readonly fallbacksUsed: readonly string[];
  readonly body: Record<string, unknown>;
}

export interface RetrievalTraceStore {
  persist(input: RetrievalTracePersistInput): Promise<StoredRetrievalTrace>;
  findLatestByFingerprint(
    scope: ProjectScope,
    fingerprint: string,
  ): Promise<StoredRetrievalTrace | null>;
}
