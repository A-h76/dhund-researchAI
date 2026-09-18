export interface TrigramDocumentHit {
  readonly documentId: string;
  readonly title: string;
}

export interface MergeCandidateRecord {
  readonly id: string;
  readonly candidateWorkId: string;
  readonly existingWorkId: string;
  readonly matchType: 'fuzzy_title';
  readonly status: 'pending';
}

export interface ProposeMergeInput {
  readonly candidateWorkId: string;
  readonly title: string;
  readonly limit: number;
  /** Caller-allocated UUIDv7 — L0 must not import platform `generateId`. */
  readonly allocateId: () => string;
}

/**
 * Trigram identity lookup (GAP-FTS-01 / E-2). A match produces a pending
 * MergeCandidate at most — never a WorkRelationship and never a merge.
 */
export interface IdentityLookupStore {
  lookupDocumentsByTitle(title: string, limit: number): Promise<readonly TrigramDocumentHit[]>;
  lookupDocumentsByAuthor(author: string, limit: number): Promise<readonly TrigramDocumentHit[]>;
  proposeMergeCandidatesByTitle(
    input: ProposeMergeInput,
  ): Promise<readonly MergeCandidateRecord[]>;
}
