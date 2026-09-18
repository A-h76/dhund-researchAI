import type { ProjectScope } from './scoped-store.port';

export type EvidenceStanceValue =
  | 'supports'
  | 'contradicts'
  | 'neutral'
  | 'unresolved';

export type EvidenceTypeValue = 'body_grounded' | 'metadata_only';

export interface EvidenceLookupRow {
  readonly id: string;
  readonly chunkId: string;
  readonly sourceId: string;
  readonly stance: EvidenceStanceValue;
  readonly qualityScore: number;
  readonly type: EvidenceTypeValue;
}

export interface SourceLookupRow {
  readonly id: string;
  readonly documentId: string;
}

export interface EvidenceLookupResult {
  readonly evidence: readonly EvidenceLookupRow[];
  readonly sources: readonly SourceLookupRow[];
}

/** Read-only mapping of existing Evidence/Source rows onto retrieval candidates. */
export interface EvidenceLookup {
  lookup(
    scope: ProjectScope,
    chunkIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<EvidenceLookupResult>;
}
