import type {
  CanonicalWorkRecord,
  ExternalIdentifierRecord,
  IdentitySpineStore,
  MergeCandidateSpineRecord,
  MergeMatchTypeValue,
  WorkBibliographicView,
} from '../../src/l0/ports/identity-spine.port';
import type { IdentityLookupStore, MergeCandidateRecord } from '../../src/l0/ports/identity-lookup.port';
import { MemoryIdentityLookupStore } from '../fixtures/memory-identity-lookup';

/**
 * In-memory identity spine for DHB-71 unit tests.
 * Intentionally omits any project/document collections (E-3 / E-4).
 */
export class MemoryIdentitySpineStore implements IdentitySpineStore {
  works = new Map<string, CanonicalWorkRecord>();
  identifiers: ExternalIdentifierRecord[] = [];
  mergeCandidates: MergeCandidateSpineRecord[] = [];
  linkedDocuments = new Map<string, string>();
  linkedExternalRecords = new Map<string, string>();

  async findWorkByIdentifier(
    scheme: ExternalIdentifierRecord['scheme'],
    value: string,
  ): Promise<CanonicalWorkRecord | null> {
    const hit = this.identifiers.find(
      (row) => row.scheme === scheme && row.value === value,
    );
    return hit === undefined ? null : (this.works.get(hit.canonicalWorkId) ?? null);
  }

  async getWork(id: string): Promise<CanonicalWorkRecord | null> {
    return this.works.get(id) ?? null;
  }

  async createWork(
    input: CanonicalWorkRecord,
  ): Promise<CanonicalWorkRecord> {
    this.works.set(input.id, input);
    return input;
  }

  async attachIdentifier(
    input: ExternalIdentifierRecord,
  ): Promise<ExternalIdentifierRecord> {
    this.identifiers.push(input);
    return input;
  }

  async listIdentifiers(canonicalWorkId: string) {
    return this.identifiers.filter((row) => row.canonicalWorkId === canonicalWorkId);
  }

  async createMergeCandidate(input: {
    readonly id: string;
    readonly candidateWorkId: string;
    readonly existingWorkId: string;
    readonly matchType: MergeMatchTypeValue;
    readonly evidence: Readonly<Record<string, unknown>>;
  }): Promise<MergeCandidateSpineRecord | null> {
    const duplicate = this.mergeCandidates.some(
      (row) =>
        row.candidateWorkId === input.candidateWorkId &&
        row.existingWorkId === input.existingWorkId &&
        row.status === 'pending',
    );
    if (duplicate) {
      return null;
    }
    const row: MergeCandidateSpineRecord = {
      id: input.id,
      candidateWorkId: input.candidateWorkId,
      existingWorkId: input.existingWorkId,
      matchType: input.matchType,
      evidence: input.evidence,
      status: 'pending',
      reviewedBy: null,
    };
    this.mergeCandidates.push(row);
    return row;
  }

  async getMergeCandidate(id: string) {
    return this.mergeCandidates.find((row) => row.id === id) ?? null;
  }

  async transitionMergeCandidate(input: {
    readonly id: string;
    readonly fromStatus: MergeCandidateSpineRecord['status'];
    readonly toStatus: MergeCandidateSpineRecord['status'];
    readonly reviewedBy: string;
  }) {
    const row = this.mergeCandidates.find((candidate) => candidate.id === input.id);
    if (row === undefined || row.status !== input.fromStatus) {
      throw new Error('precondition');
    }
    const next: MergeCandidateSpineRecord = {
      ...row,
      status: input.toStatus,
      reviewedBy: input.reviewedBy,
    };
    this.mergeCandidates = this.mergeCandidates.map((candidate) =>
      candidate.id === input.id ? next : candidate,
    );
    return next;
  }

  async mergeWorksUnderAudit(input: {
    readonly mergeCandidateId: string;
    readonly reviewedBy: string;
  }) {
    const row = this.mergeCandidates.find((candidate) => candidate.id === input.mergeCandidateId);
    if (row === undefined || row.status !== 'pending') {
      throw new Error('not pending');
    }
    if (row.matchType === 'fuzzy_title') {
      throw new Error('fuzzy_title merge rejected by honesty invariant');
    }
    this.identifiers = this.identifiers.map((ident) =>
      ident.canonicalWorkId === row.candidateWorkId
        ? { ...ident, canonicalWorkId: row.existingWorkId }
        : ident,
    );
    return this.transitionMergeCandidate({
      id: row.id,
      fromStatus: 'pending',
      toStatus: 'merged',
      reviewedBy: input.reviewedBy,
    });
  }

  async getMergeReviewView(mergeCandidateId: string) {
    const candidate = await this.getMergeCandidate(mergeCandidateId);
    if (candidate === null) {
      return null;
    }
    const candidateWork = await this.bib(candidate.candidateWorkId);
    const existingWork = await this.bib(candidate.existingWorkId);
    if (candidateWork === null || existingWork === null) {
      return null;
    }
    return { candidate, candidateWork, existingWork };
  }

  async linkDocumentToWork(documentId: string, canonicalWorkId: string) {
    this.linkedDocuments.set(documentId, canonicalWorkId);
  }

  async linkExternalRecordToWork(externalRecordId: string, canonicalWorkId: string) {
    this.linkedExternalRecords.set(externalRecordId, canonicalWorkId);
  }

  private async bib(workId: string): Promise<WorkBibliographicView | null> {
    const work = this.works.get(workId);
    if (work === undefined) {
      return null;
    }
    return {
      id: work.id,
      canonicalTitle: work.canonicalTitle,
      year: work.year,
      type: work.type,
      identifiers: this.identifiers
        .filter((row) => row.canonicalWorkId === workId)
        .map((row) => ({ scheme: row.scheme, value: row.value })),
    };
  }
}

/** Bridge trigram memory store into propose path used by resolve. */
export function asTrigramLookup(store: MemoryIdentityLookupStore): IdentityLookupStore {
  return store;
}

export type { MergeCandidateRecord };
