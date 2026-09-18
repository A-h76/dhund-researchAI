import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  IdentityLookupStore,
  MergeCandidateRecord,
  ProposeMergeInput,
  TrigramDocumentHit,
} from '../../ports/identity-lookup.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

/** Title identity lookup — consumes `idx_documents_title_trgm`. */
export const DOCUMENT_TITLE_TRGM_SQL = `
SELECT d.id AS "documentId", d.title
FROM documents d
WHERE d.deleted_at IS NULL
  AND d.title % $1
ORDER BY similarity(d.title, $1) DESC
LIMIT $2
`.trim();

/** Author identity lookup — consumes `idx_documents_authors_trgm`. */
export const DOCUMENT_AUTHOR_TRGM_SQL = `
SELECT d.id AS "documentId", d.title
FROM documents d
WHERE d.deleted_at IS NULL
  AND immutable_text_array_join(d.authors, ' ') % $1
ORDER BY similarity(immutable_text_array_join(d.authors, ' '), $1) DESC
LIMIT $2
`.trim();

/** Canonical-title identity lookup — consumes `idx_canonical_works_title_trgm`. */
export const CANONICAL_TITLE_TRGM_SQL = `
SELECT cw.id AS "workId", similarity(cw.canonical_title, $1) AS similarity
FROM canonical_works cw
WHERE cw.id <> $2::uuid
  AND cw.canonical_title % $1
ORDER BY similarity(cw.canonical_title, $1) DESC
LIMIT $3
`.trim();

/**
 * Honesty invariant (E-2): this adapter inserts merge_candidates rows and
 * never writes a WorkRelationship. A trigram hit is a candidate, not a merge.
 */
@Injectable()
export class PrismaIdentityLookupAdapter implements IdentityLookupStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async lookupDocumentsByTitle(
    title: string,
    limit: number,
  ): Promise<readonly TrigramDocumentHit[]> {
    await this.database.connect();
    try {
      return await this.client().$queryRawUnsafe<TrigramDocumentHit[]>(
        DOCUMENT_TITLE_TRGM_SQL,
        title,
        limit,
      );
    } catch (error) {
      throw new L0OperationError('Title trigram lookup failed', error);
    }
  }

  async lookupDocumentsByAuthor(
    author: string,
    limit: number,
  ): Promise<readonly TrigramDocumentHit[]> {
    await this.database.connect();
    try {
      return await this.client().$queryRawUnsafe<TrigramDocumentHit[]>(
        DOCUMENT_AUTHOR_TRGM_SQL,
        author,
        limit,
      );
    } catch (error) {
      throw new L0OperationError('Author trigram lookup failed', error);
    }
  }

  async proposeMergeCandidatesByTitle(
    input: ProposeMergeInput,
  ): Promise<readonly MergeCandidateRecord[]> {
    await this.database.connect();
    try {
      const matches = await this.client().$queryRawUnsafe<
        Array<{ workId: string; similarity: number }>
      >(CANONICAL_TITLE_TRGM_SQL, input.title, input.candidateWorkId, input.limit);

      const proposed: MergeCandidateRecord[] = [];
      for (const match of matches) {
        const row = await this.insertPendingCandidate(
          input.allocateId(),
          input.candidateWorkId,
          match.workId,
          input.title,
          match.similarity,
        );
        if (row !== null) {
          proposed.push(row);
        }
      }
      return proposed;
    } catch (error) {
      throw new L0OperationError('Trigram merge-candidate propose failed', error);
    }
  }

  private async insertPendingCandidate(
    id: string,
    candidateWorkId: string,
    existingWorkId: string,
    title: string,
    similarity: number,
  ): Promise<MergeCandidateRecord | null> {
    try {
      await this.client().mergeCandidate.create({
        data: {
          id,
          candidateWorkId,
          existingWorkId,
          matchType: 'fuzzy_title',
          status: 'pending',
          evidence: { title, similarity } as Prisma.InputJsonValue,
        },
      });
      return {
        id,
        candidateWorkId,
        existingWorkId,
        matchType: 'fuzzy_title',
        status: 'pending',
      };
    } catch (error) {
      if (isPendingPairConflict(error)) {
        return null;
      }
      throw error;
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function isPendingPairConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
