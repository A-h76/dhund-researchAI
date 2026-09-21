/**
 * Canonical Work identity spine (DHB-71).
 *
 * Honesty invariant (E-2): fuzzy/trigram matches produce pending MergeCandidates
 * only — never a WorkRelationship and never an automatic merge.
 *
 * Isolation (E-3 / E-4): resolve and merge-review surfaces return bibliographic
 * identity only — never project documents, evidence, notes, or memberships.
 */

export type IdentifierSchemeValue = 'doi' | 'pmid' | 'arxiv' | 'isbn' | 's2_id';

/** Schema enum; product observability labels fuzzy_title as fuzzy_only. */
export type MergeMatchTypeValue =
  | 'exact_doi'
  | 'corroborated_pmid_arxiv'
  | 'fuzzy_title';

export type MergeStatusValue = 'pending' | 'merged' | 'rejected';

export type CanonicalWorkTypeValue = 'article' | 'preprint' | 'chapter' | 'book';

export interface CanonicalWorkRecord {
  readonly id: string;
  readonly canonicalTitle: string;
  readonly authorHash: string;
  readonly year: number | null;
  readonly type: CanonicalWorkTypeValue;
}

export interface ExternalIdentifierRecord {
  readonly id: string;
  readonly canonicalWorkId: string;
  readonly scheme: IdentifierSchemeValue;
  readonly value: string;
}

export interface MergeCandidateSpineRecord {
  readonly id: string;
  readonly candidateWorkId: string;
  readonly existingWorkId: string;
  readonly matchType: MergeMatchTypeValue;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly status: MergeStatusValue;
  readonly reviewedBy: string | null;
}

export interface WorkBibliographicView {
  readonly id: string;
  readonly canonicalTitle: string;
  readonly year: number | null;
  readonly type: CanonicalWorkTypeValue;
  readonly identifiers: readonly {
    readonly scheme: IdentifierSchemeValue;
    readonly value: string;
  }[];
}

export interface IdentitySpineStore {
  findWorkByIdentifier(
    scheme: IdentifierSchemeValue,
    value: string,
  ): Promise<CanonicalWorkRecord | null>;

  getWork(id: string): Promise<CanonicalWorkRecord | null>;

  createWork(input: {
    readonly id: string;
    readonly canonicalTitle: string;
    readonly authorHash: string;
    readonly year: number | null;
    readonly type: CanonicalWorkTypeValue;
  }): Promise<CanonicalWorkRecord>;

  attachIdentifier(input: {
    readonly id: string;
    readonly canonicalWorkId: string;
    readonly scheme: IdentifierSchemeValue;
    readonly value: string;
  }): Promise<ExternalIdentifierRecord>;

  listIdentifiers(canonicalWorkId: string): Promise<readonly ExternalIdentifierRecord[]>;

  createMergeCandidate(input: {
    readonly id: string;
    readonly candidateWorkId: string;
    readonly existingWorkId: string;
    readonly matchType: MergeMatchTypeValue;
    readonly evidence: Readonly<Record<string, unknown>>;
  }): Promise<MergeCandidateSpineRecord | null>;

  getMergeCandidate(id: string): Promise<MergeCandidateSpineRecord | null>;

  transitionMergeCandidate(input: {
    readonly id: string;
    readonly fromStatus: MergeStatusValue;
    readonly toStatus: MergeStatusValue;
    readonly reviewedBy: string;
  }): Promise<MergeCandidateSpineRecord>;

  /**
   * Rewires identifiers from candidate → existing and marks the candidate merged.
   * Never invoked for fuzzy_title matches without an explicit reviewed approval path.
   */
  mergeWorksUnderAudit(input: {
    readonly mergeCandidateId: string;
    readonly reviewedBy: string;
  }): Promise<MergeCandidateSpineRecord>;

  /** Bibliographic-only merge review view — no project-scoped rows. */
  getMergeReviewView(mergeCandidateId: string): Promise<{
    readonly candidate: MergeCandidateSpineRecord;
    readonly candidateWork: WorkBibliographicView;
    readonly existingWork: WorkBibliographicView;
  } | null>;

  linkDocumentToWork(documentId: string, canonicalWorkId: string): Promise<void>;

  linkExternalRecordToWork(
    externalRecordId: string,
    canonicalWorkId: string,
  ): Promise<void>;
}

export const IDENTITY_SPINE_STORE = Symbol('IDENTITY_SPINE_STORE');

/** Observability label for MergeMatchType (ticket language). */
export function mergeMatchObservabilityLabel(
  matchType: MergeMatchTypeValue,
): 'doi_exact' | 'fuzzy_only' | 'corroborated_pmid_arxiv' {
  switch (matchType) {
    case 'exact_doi':
      return 'doi_exact';
    case 'fuzzy_title':
      return 'fuzzy_only';
    case 'corroborated_pmid_arxiv':
      return 'corroborated_pmid_arxiv';
    default: {
      const exhaustive: never = matchType;
      return exhaustive;
    }
  }
}
