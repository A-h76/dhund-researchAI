import { Injectable } from '@nestjs/common';
import { WritingStatus, WritingType } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  StoredWriting,
  StoredWritingBinding,
  StoredWritingVersion,
  WritingEvidenceLink,
  WritingStore,
} from '../../ports/writing-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaWritingStoreAdapter implements WritingStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async insertWriting(input: {
    id: string;
    projectId: string;
    title: string;
    createdBy: string;
  }): Promise<StoredWriting> {
    await this.database.connect();
    try {
      const row = await this.client().writing.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          title: input.title,
          type: WritingType.manuscript,
          status: WritingStatus.draft,
          createdBy: input.createdBy,
        },
      });
      return toWriting(row);
    } catch (error) {
      throw new L0OperationError('Writing insert failed', error);
    }
  }

  async findWriting(writingId: string): Promise<StoredWriting | null> {
    await this.database.connect();
    try {
      const row = await this.client().writing.findUnique({ where: { id: writingId } });
      if (row === null || row.deletedAt !== null) {
        return null;
      }
      return toWriting(row);
    } catch (error) {
      throw new L0OperationError('Writing lookup failed', error);
    }
  }

  async insertVersion(input: {
    id: string;
    writingId: string;
    versionNo: number;
    contentRef: string;
    createdBy: string;
  }): Promise<StoredWritingVersion> {
    await this.database.connect();
    try {
      const row = await this.client().$transaction(async (tx) => {
        const created = await tx.writingVersion.create({
          data: {
            id: input.id,
            writingId: input.writingId,
            versionNo: input.versionNo,
            contentRef: input.contentRef,
            createdBy: input.createdBy,
          },
        });
        await tx.writing.update({
          where: { id: input.writingId },
          data: { currentVersionId: created.id },
        });
        return created;
      });
      return {
        id: row.id,
        writingId: row.writingId,
        versionNo: row.versionNo,
        contentRef: row.contentRef,
        createdBy: row.createdBy,
      };
    } catch (error) {
      throw new L0OperationError('Writing version insert failed', error);
    }
  }

  async listVersions(writingId: string): Promise<readonly StoredWritingVersion[]> {
    await this.database.connect();
    try {
      const rows = await this.client().writingVersion.findMany({
        where: { writingId },
        orderBy: { versionNo: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        writingId: row.writingId,
        versionNo: row.versionNo,
        contentRef: row.contentRef,
        createdBy: row.createdBy,
      }));
    } catch (error) {
      throw new L0OperationError('Writing version list failed', error);
    }
  }

  async insertBinding(input: StoredWritingBinding): Promise<StoredWritingBinding> {
    await this.database.connect();
    try {
      const clash = await this.client().messageEvidenceBinding.findFirst({
        where: { projectId: input.projectId, evidenceId: input.evidenceId },
        select: { id: true },
      });
      if (clash !== null) {
        throw new L0OperationError('Writing and message evidence bindings are disjoint');
      }
      await this.client().writingSentenceBinding.create({
        data: {
          id: input.id,
          writingId: input.writingId,
          writingVersionId: input.writingVersionId,
          projectId: input.projectId,
          sentenceHash: input.sentenceHash,
          evidenceId: input.evidenceId,
          strength: input.strength,
        },
      });
      return input;
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }
      throw new L0OperationError('Writing binding insert failed', error);
    }
  }

  async listBindings(writingVersionId: string): Promise<readonly StoredWritingBinding[]> {
    await this.database.connect();
    try {
      const rows = await this.client().writingSentenceBinding.findMany({
        where: { writingVersionId },
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
      throw new L0OperationError('Writing binding list failed', error);
    }
  }

  async findEvidence(evidenceId: string): Promise<WritingEvidenceLink | null> {
    await this.database.connect();
    try {
      const row = await this.client().evidence.findUnique({
        where: { id: evidenceId },
        select: { id: true, projectId: true, supersededById: true },
      });
      return row;
    } catch (error) {
      throw new L0OperationError('Writing evidence lookup failed', error);
    }
  }

  async messageBindingExists(projectId: string, evidenceId: string): Promise<boolean> {
    await this.database.connect();
    try {
      const row = await this.client().messageEvidenceBinding.findFirst({
        where: { projectId, evidenceId },
        select: { id: true },
      });
      return row !== null;
    } catch (error) {
      throw new L0OperationError('Message binding lookup failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function toWriting(row: {
  id: string;
  projectId: string;
  title: string;
  currentVersionId: string | null;
  deletedAt: Date | null;
}): StoredWriting {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    currentVersionId: row.currentVersionId,
    deletedAt: row.deletedAt,
  };
}
