import type {
  IdentityLookupStore,
  MergeCandidateRecord,
  ProposeMergeInput,
  TrigramDocumentHit,
} from '../../src/l0/ports/identity-lookup.port';

export interface MemoryIdentityDocument {
  readonly documentId: string;
  readonly title: string;
  readonly authors: readonly string[];
}

export interface MemoryCanonicalWork {
  readonly workId: string;
  readonly title: string;
}

/**
 * In-memory identity lookup. Holds merge candidates only — there is no
 * work-relationship collection on purpose (E-2).
 */
export class MemoryIdentityLookupStore implements IdentityLookupStore {
  documents: MemoryIdentityDocument[] = [];
  canonicalWorks: MemoryCanonicalWork[] = [];
  readonly mergeCandidates: MergeCandidateRecord[] = [];

  lookupDocumentsByTitle(
    title: string,
    limit: number,
  ): Promise<readonly TrigramDocumentHit[]> {
    const needle = title.toLowerCase();
    return Promise.resolve(
      this.documents
        .filter((document) => document.title.toLowerCase().includes(needle))
        .slice(0, limit)
        .map((document) => ({
          documentId: document.documentId,
          title: document.title,
        })),
    );
  }

  lookupDocumentsByAuthor(
    author: string,
    limit: number,
  ): Promise<readonly TrigramDocumentHit[]> {
    const needle = author.toLowerCase();
    return Promise.resolve(
      this.documents
        .filter((document) =>
          document.authors.some((name) => name.toLowerCase().includes(needle)),
        )
        .slice(0, limit)
        .map((document) => ({
          documentId: document.documentId,
          title: document.title,
        })),
    );
  }

  proposeMergeCandidatesByTitle(
    input: ProposeMergeInput,
  ): Promise<readonly MergeCandidateRecord[]> {
    const needle = input.title.toLowerCase();
    const proposed: MergeCandidateRecord[] = [];
    for (const work of this.canonicalWorks) {
      if (proposed.length >= input.limit) {
        break;
      }
      if (work.workId === input.candidateWorkId) {
        continue;
      }
      if (!work.title.toLowerCase().includes(needle) && !needle.includes(work.title.toLowerCase())) {
        continue;
      }
      const duplicate = this.mergeCandidates.some(
        (row) =>
          row.candidateWorkId === input.candidateWorkId &&
          row.existingWorkId === work.workId &&
          row.status === 'pending',
      );
      if (duplicate) {
        continue;
      }
      const row: MergeCandidateRecord = {
        id: input.allocateId(),
        candidateWorkId: input.candidateWorkId,
        existingWorkId: work.workId,
        matchType: 'fuzzy_title',
        status: 'pending',
      };
      this.mergeCandidates.push(row);
      proposed.push(row);
    }
    return Promise.resolve(proposed);
  }
}
