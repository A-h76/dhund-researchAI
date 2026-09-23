import { Injectable } from '@nestjs/common';
import { EvidenceType, Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  CitationProjectionPort,
  CitationRecord,
  CreateCitationInput,
  SentenceBindingRecord,
  WritingRecord,
} from '../../ports/citation-projection.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaCitationProjectionAdapter implements CitationProjectionPort {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async createCitation(input: CreateCitationInput): Promise<CitationRecord> {
    await this.ensureConnected();
    const evidenceId = input.resolvesToEvidenceId ?? null;
    const sourceId = input.resolvesToSourceId ?? null;
    const targetCount = (evidenceId === null ? 0 : 1) + (sourceId === null ? 0 : 1);
    if (targetCount !== 1) {
      throw new L0OperationError('Citation must resolve to exactly one target');
    }
    try {
      const row = await this.client().citation.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          writingId: input.writingId ?? null,
          resolvesToEvidenceId: evidenceId,
          resolvesToSourceId: sourceId,
          cslJson: input.cslJson as Prisma.InputJsonValue,
          qualityAnnotation:
            input.qualityAnnotation === 'body_grounded'
              ? EvidenceType.body_grounded
              : EvidenceType.metadata_only,
        },
      });
      return toCitation(row);
    } catch (error) {
      throw new L0OperationError('Citation create failed', error);
    }
  }

  async listCitations(projectId: string): Promise<readonly CitationRecord[]> {
    await this.ensureConnected();
    try {
      const rows = await this.client().citation.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toCitation);
    } catch (error) {
      throw new L0OperationError('Citation list failed', error);
    }
  }

  async findWriting(writingId: string): Promise<WritingRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().writing.findUnique({
        where: { id: writingId },
        select: {
          id: true,
          projectId: true,
          currentVersionId: true,
          deletedAt: true,
        },
      });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        projectId: row.projectId,
        currentVersionId: row.currentVersionId,
        deletedAt: row.deletedAt,
      };
    } catch (error) {
      throw new L0OperationError('Writing lookup failed', error);
    }
  }

  async listBindingsForSentence(input: {
    writingId: string;
    writingVersionId: string;
    sentenceHash: string;
    projectId: string;
  }): Promise<readonly SentenceBindingRecord[]> {
    await this.ensureConnected();
    try {
      const rows = await this.client().writingSentenceBinding.findMany({
        where: {
          writingId: input.writingId,
          writingVersionId: input.writingVersionId,
          sentenceHash: input.sentenceHash,
          projectId: input.projectId,
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        writingId: row.writingId,
        writingVersionId: row.writingVersionId,
        projectId: row.projectId,
        sentenceHash: row.sentenceHash,
        evidenceId: row.evidenceId,
        strength: row.strength.toString(),
      }));
    } catch (error) {
      throw new L0OperationError('Sentence-binding lookup failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }

  private async ensureConnected(): Promise<void> {
    await this.database.connect();
  }
}

function toCitation(row: {
  id: string;
  projectId: string;
  writingId: string | null;
  resolvesToEvidenceId: string | null;
  resolvesToSourceId: string | null;
  cslJson: Prisma.JsonValue;
  qualityAnnotation: EvidenceType;
}): CitationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    writingId: row.writingId,
    resolvesToEvidenceId: row.resolvesToEvidenceId,
    resolvesToSourceId: row.resolvesToSourceId,
    cslJson: row.cslJson,
    qualityAnnotation:
      row.qualityAnnotation === EvidenceType.body_grounded
        ? 'body_grounded'
        : 'metadata_only',
  };
}
