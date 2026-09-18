import type {
  ProjectScope,
  RetrievalTracePersistInput,
  RetrievalTraceStore,
  StoredRetrievalTrace,
} from '../../src/l0/ports';

export class MemoryRetrievalTraces implements RetrievalTraceStore {
  readonly rows: StoredRetrievalTrace[] = [];

  persist(input: RetrievalTracePersistInput): Promise<StoredRetrievalTrace> {
    const stored: StoredRetrievalTrace = {
      id: input.id,
      projectId: input.projectId,
      queryFingerprint: input.queryFingerprint,
      embeddingModel: input.embeddingModel,
      embeddingVersion: input.embeddingVersion,
      k: input.k,
      overFetchFactor: input.overFetchFactor,
      efSearch: input.efSearch,
      fallbacksUsed: input.fallbacksUsed,
      body: input.body,
    };
    this.rows.push(stored);
    return Promise.resolve(stored);
  }

  findLatestByFingerprint(
    scope: ProjectScope,
    fingerprint: string,
  ): Promise<StoredRetrievalTrace | null> {
    const matches = this.rows.filter(
      (row) => row.projectId === scope.projectId && row.queryFingerprint === fingerprint,
    );
    return Promise.resolve(matches.length === 0 ? null : matches[matches.length - 1]!);
  }
}
