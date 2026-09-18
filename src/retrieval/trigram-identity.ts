import { Inject, Injectable } from '@nestjs/common';
import {
  IDENTITY_LOOKUP,
  type IdentityLookupStore,
  type MergeCandidateRecord,
  type TrigramDocumentHit,
} from '../l0/ports';
import { generateId } from '../platform/ids/uuid-v7';

const DEFAULT_LIMIT = 10;

/**
 * GAP-FTS-01 / E-2. Trigram identity lookup. A match is never a merge and
 * never a WorkRelationship — proposeMergeCandidatesByTitle inserts a pending
 * MergeCandidate at most.
 */
@Injectable()
export class TrigramIdentityLookup {
  constructor(@Inject(IDENTITY_LOOKUP) private readonly store: IdentityLookupStore) {}

  lookupDocumentsByTitle(
    title: string,
    limit: number = DEFAULT_LIMIT,
  ): Promise<readonly TrigramDocumentHit[]> {
    return this.store.lookupDocumentsByTitle(title, limit);
  }

  lookupDocumentsByAuthor(
    author: string,
    limit: number = DEFAULT_LIMIT,
  ): Promise<readonly TrigramDocumentHit[]> {
    return this.store.lookupDocumentsByAuthor(author, limit);
  }

  proposeMergeCandidatesByTitle(
    candidateWorkId: string,
    title: string,
    limit: number = DEFAULT_LIMIT,
  ): Promise<readonly MergeCandidateRecord[]> {
    return this.store.proposeMergeCandidatesByTitle({
      candidateWorkId,
      title,
      limit,
      allocateId: generateId,
    });
  }
}
