import type {
  EvidenceLookup,
  EvidenceLookupResult,
  EvidenceLookupRow,
  ProjectScope,
  SourceLookupRow,
} from '../../src/l0/ports';

export class MemoryEvidenceLookup implements EvidenceLookup {
  evidence: Array<EvidenceLookupRow & { readonly projectId?: string }> = [];
  sources: Array<SourceLookupRow & { readonly projectId: string }> = [];

  lookup(
    scope: ProjectScope,
    chunkIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<EvidenceLookupResult> {
    const chunkSet = new Set(chunkIds);
    const documentSet = new Set(documentIds);
    return Promise.resolve({
      evidence: this.evidence.filter(
        (row) =>
          chunkSet.has(row.chunkId) &&
          (row.projectId === undefined || row.projectId === scope.projectId),
      ),
      sources: this.sources.filter(
        (row) => row.projectId === scope.projectId && documentSet.has(row.documentId),
      ),
    });
  }
}
