import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  CanonicalWorkRecord,
  CanonicalWorkTypeValue,
  ExternalIdentifierRecord,
  IdentifierSchemeValue,
  IdentitySpineStore,
  MergeCandidateSpineRecord,
  MergeMatchTypeValue,
  MergeStatusValue,
  WorkBibliographicView,
} from '../../ports/identity-spine.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaIdentitySpineAdapter implements IdentitySpineStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findWorkByIdentifier(
    scheme: IdentifierSchemeValue,
    value: string,
  ): Promise<CanonicalWorkRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().externalIdentifier.findUnique({
        where: { scheme_value: { scheme, value } },
        include: { canonicalWork: true },
      });
      return row === null ? null : toWork(row.canonicalWork);
    } catch (error) {
      throw new L0OperationError('identity findByIdentifier failed', error);
    }
  }

  async getWork(id: string): Promise<CanonicalWorkRecord | null> {
    await this.database.connect();
    const row = await this.client().canonicalWork.findUnique({ where: { id } });
    return row === null ? null : toWork(row);
  }

  async createWork(input: {
    readonly id: string;
    readonly canonicalTitle: string;
    readonly authorHash: string;
    readonly year: number | null;
    readonly type: CanonicalWorkTypeValue;
  }): Promise<CanonicalWorkRecord> {
    await this.database.connect();
    try {
      const row = await this.client().canonicalWork.create({
        data: {
          id: input.id,
          canonicalTitle: input.canonicalTitle,
          authorHash: input.authorHash,
          year: input.year,
          type: input.type,
        },
      });
      return toWork(row);
    } catch (error) {
      throw new L0OperationError('canonical_work create failed', error);
    }
  }

  async attachIdentifier(input: {
    readonly id: string;
    readonly canonicalWorkId: string;
    readonly scheme: IdentifierSchemeValue;
    readonly value: string;
  }): Promise<ExternalIdentifierRecord> {
    await this.database.connect();
    try {
      const row = await this.client().externalIdentifier.create({
        data: {
          id: input.id,
          canonicalWorkId: input.canonicalWorkId,
          scheme: input.scheme,
          value: input.value,
        },
      });
      return toIdentifier(row);
    } catch (error) {
      throw new L0OperationError('external_identifier attach failed', error);
    }
  }

  async listIdentifiers(
    canonicalWorkId: string,
  ): Promise<readonly ExternalIdentifierRecord[]> {
    await this.database.connect();
    const rows = await this.client().externalIdentifier.findMany({
      where: { canonicalWorkId },
    });
    return rows.map(toIdentifier);
  }

  async createMergeCandidate(input: {
    readonly id: string;
    readonly candidateWorkId: string;
    readonly existingWorkId: string;
    readonly matchType: MergeMatchTypeValue;
    readonly evidence: Readonly<Record<string, unknown>>;
  }): Promise<MergeCandidateSpineRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().mergeCandidate.create({
        data: {
          id: input.id,
          candidateWorkId: input.candidateWorkId,
          existingWorkId: input.existingWorkId,
          matchType: input.matchType,
          status: 'pending',
          evidence: input.evidence as Prisma.InputJsonValue,
        },
      });
      return toMerge(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw new L0OperationError('merge_candidate create failed', error);
    }
  }

  async getMergeCandidate(id: string): Promise<MergeCandidateSpineRecord | null> {
    await this.database.connect();
    const row = await this.client().mergeCandidate.findUnique({ where: { id } });
    return row === null ? null : toMerge(row);
  }

  async transitionMergeCandidate(input: {
    readonly id: string;
    readonly fromStatus: MergeStatusValue;
    readonly toStatus: MergeStatusValue;
    readonly reviewedBy: string;
  }): Promise<MergeCandidateSpineRecord> {
    await this.database.connect();
    const current = await this.client().mergeCandidate.findUnique({
      where: { id: input.id },
    });
    if (current === null || current.status !== input.fromStatus) {
      throw new L0OperationError('merge_candidate transition precondition failed');
    }
    const row = await this.client().mergeCandidate.update({
      where: { id: input.id },
      data: {
        status: input.toStatus,
        reviewedBy: input.reviewedBy,
      },
    });
    return toMerge(row);
  }

  async mergeWorksUnderAudit(input: {
    readonly mergeCandidateId: string;
    readonly reviewedBy: string;
  }): Promise<MergeCandidateSpineRecord> {
    await this.database.connect();
    try {
      return await this.client().$transaction(async (tx) => {
        const candidate = await tx.mergeCandidate.findUnique({
          where: { id: input.mergeCandidateId },
        });
        if (candidate === null || candidate.status !== 'pending') {
          throw new L0OperationError('merge candidate not pending');
        }
        // Fuzzy matches must never reach automatic merge — caller enforces matchType.
        if (candidate.matchType === 'fuzzy_title') {
          throw new L0OperationError('fuzzy_title merge rejected by honesty invariant');
        }

        const identifiers = await tx.externalIdentifier.findMany({
          where: { canonicalWorkId: candidate.candidateWorkId },
        });
        for (const ident of identifiers) {
          await tx.externalIdentifier.update({
            where: { id: ident.id },
            data: { canonicalWorkId: candidate.existingWorkId },
          });
        }

        await tx.document.updateMany({
          where: { canonicalWorkId: candidate.candidateWorkId },
          data: { canonicalWorkId: candidate.existingWorkId },
        });
        await tx.externalRecord.updateMany({
          where: { linkedCanonicalWorkId: candidate.candidateWorkId },
          data: { linkedCanonicalWorkId: candidate.existingWorkId },
        });

        const row = await tx.mergeCandidate.update({
          where: { id: candidate.id },
          data: {
            status: 'merged',
            reviewedBy: input.reviewedBy,
          },
        });
        return toMerge(row);
      });
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }
      throw new L0OperationError('identity merge under audit failed', error);
    }
  }

  async getMergeReviewView(mergeCandidateId: string): Promise<{
    readonly candidate: MergeCandidateSpineRecord;
    readonly candidateWork: WorkBibliographicView;
    readonly existingWork: WorkBibliographicView;
  } | null> {
    await this.database.connect();
    const candidate = await this.client().mergeCandidate.findUnique({
      where: { id: mergeCandidateId },
    });
    if (candidate === null) {
      return null;
    }
    const [candidateWork, existingWork] = await Promise.all([
      this.loadBibliographic(candidate.candidateWorkId),
      this.loadBibliographic(candidate.existingWorkId),
    ]);
    if (candidateWork === null || existingWork === null) {
      return null;
    }
    return {
      candidate: toMerge(candidate),
      candidateWork,
      existingWork,
    };
  }

  async linkDocumentToWork(documentId: string, canonicalWorkId: string): Promise<void> {
    await this.database.connect();
    await this.client().document.update({
      where: { id: documentId },
      data: { canonicalWorkId },
    });
  }

  async linkExternalRecordToWork(
    externalRecordId: string,
    canonicalWorkId: string,
  ): Promise<void> {
    await this.database.connect();
    await this.client().externalRecord.update({
      where: { id: externalRecordId },
      data: { linkedCanonicalWorkId: canonicalWorkId },
    });
  }

  private async loadBibliographic(workId: string): Promise<WorkBibliographicView | null> {
    const work = await this.client().canonicalWork.findUnique({
      where: { id: workId },
      include: { externalIdentifiers: true },
    });
    if (work === null) {
      return null;
    }
    return {
      id: work.id,
      canonicalTitle: work.canonicalTitle,
      year: work.year,
      type: work.type as CanonicalWorkTypeValue,
      identifiers: work.externalIdentifiers.map((row) => ({
        scheme: row.scheme as IdentifierSchemeValue,
        value: row.value,
      })),
    };
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function toWork(row: {
  id: string;
  canonicalTitle: string;
  authorHash: string;
  year: number | null;
  type: string;
}): CanonicalWorkRecord {
  return {
    id: row.id,
    canonicalTitle: row.canonicalTitle,
    authorHash: row.authorHash,
    year: row.year,
    type: row.type as CanonicalWorkTypeValue,
  };
}

function toIdentifier(row: {
  id: string;
  canonicalWorkId: string;
  scheme: string;
  value: string;
}): ExternalIdentifierRecord {
  return {
    id: row.id,
    canonicalWorkId: row.canonicalWorkId,
    scheme: row.scheme as IdentifierSchemeValue,
    value: row.value,
  };
}

function toMerge(row: {
  id: string;
  candidateWorkId: string;
  existingWorkId: string;
  matchType: string;
  evidence: unknown;
  status: string;
  reviewedBy: string | null;
}): MergeCandidateSpineRecord {
  return {
    id: row.id,
    candidateWorkId: row.candidateWorkId,
    existingWorkId: row.existingWorkId,
    matchType: row.matchType as MergeMatchTypeValue,
    evidence:
      typeof row.evidence === 'object' && row.evidence !== null && !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : {},
    status: row.status as MergeStatusValue,
    reviewedBy: row.reviewedBy,
  };
}
