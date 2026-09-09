import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type {
  ProjectErasureStore,
  TombstonedProject,
} from '../../ports/project-erasure.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaProjectErasureAdapter implements ProjectErasureStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findTombstonedProject(
    projectId: string,
  ): Promise<TombstonedProject | null> {
    await this.database.connect();
    try {
      const row = await this.client().project.findFirst({
        where: { id: projectId, deletedAt: { not: null } },
        select: { id: true, orgId: true, deletedAt: true },
      });
      if (row === null || row.deletedAt === null) {
        return null;
      }
      return { id: row.id, orgId: row.orgId, deletedAt: row.deletedAt };
    } catch (error) {
      throw new L0OperationError('Tombstoned project lookup failed', error);
    }
  }

  async stampOwnedDeletedAt(projectId: string): Promise<number> {
    await this.database.connect();
    const now = new Date();
    try {
      const client = this.client();
      const results = await Promise.all([
        client.document.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
        client.claim.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
        client.conversation.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
        client.externalRecord.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
        client.writing.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
        client.libraryFolder.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
        client.libraryItem.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: now },
        }),
      ]);
      return results.reduce((sum, row) => sum + row.count, 0);
    } catch (error) {
      throw new L0OperationError('Owned-table tombstone failed', error);
    }
  }

  async listStorageKeys(projectId: string): Promise<readonly string[]> {
    await this.database.connect();
    try {
      const client = this.client();
      const [documents, versions, artifacts, uploads] = await Promise.all([
        client.document.findMany({
          where: { projectId },
          select: { storageKey: true },
        }),
        client.documentVersion.findMany({
          where: { document: { projectId } },
          select: { storageKey: true },
        }),
        client.researchArtifact.findMany({
          where: { run: { projectId } },
          select: { storageKey: true },
        }),
        client.uploadSession.findMany({
          where: { projectId },
          select: { storageKey: true },
        }),
      ]);
      const keys = [
        ...documents.map((row) => row.storageKey),
        ...versions.map((row) => row.storageKey),
        ...artifacts
          .map((row) => row.storageKey)
          .filter((key): key is string => key !== null),
        ...uploads.map((row) => row.storageKey),
      ];
      return unique(keys);
    } catch (error) {
      throw new L0OperationError('Storage key list failed', error);
    }
  }

  async anonymiseAuditActors(projectId: string): Promise<number> {
    await this.database.connect();
    try {
      const updated = await this.client().$executeRaw`
        UPDATE audit_events
        SET actor_id = NULL
        WHERE scope->>'projectId' = ${projectId}
          AND actor_id IS NOT NULL
      `;
      return Number(updated);
    } catch (error) {
      throw new L0OperationError('Audit actor anonymisation failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function unique(keys: readonly string[]): readonly string[] {
  return [...new Set(keys.filter((key) => key.length > 0))];
}
