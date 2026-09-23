import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import {
  descendantFolderIds,
  filingMoves,
  type FolderNode,
} from '../../ports/library-folder-delete';
import type {
  LibraryDocumentTarget,
  LibraryExternalTarget,
  LibraryFolderRecord,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryStore,
} from '../../ports/library.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaLibraryAdapter implements LibraryStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findDocument(
    projectId: string,
    documentId: string,
  ): Promise<LibraryDocumentTarget | null> {
    await this.database.connect();
    try {
      const row = await this.client().document.findFirst({
        where: { id: documentId, projectId, deletedAt: null },
        select: {
          id: true,
          projectId: true,
          title: true,
          authors: true,
          year: true,
        },
      });
      return row;
    } catch (error) {
      throw new L0OperationError('Library document lookup failed', error);
    }
  }

  async findExternal(
    projectId: string,
    externalRecordId: string,
  ): Promise<LibraryExternalTarget | null> {
    await this.database.connect();
    try {
      const row = await this.client().externalRecord.findFirst({
        where: { id: externalRecordId, projectId, deletedAt: null },
        select: {
          id: true,
          projectId: true,
          snapshots: {
            orderBy: { capturedAt: 'desc' },
            take: 1,
            select: { metadata: true },
          },
        },
      });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        projectId: row.projectId,
        ...bibliographyFromMetadata(row.snapshots[0]?.metadata),
      };
    } catch (error) {
      throw new L0OperationError('Library external-record lookup failed', error);
    }
  }

  async listDocuments(projectId: string): Promise<readonly LibraryDocumentTarget[]> {
    await this.database.connect();
    try {
      return await this.client().document.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          projectId: true,
          title: true,
          authors: true,
          year: true,
        },
        orderBy: { id: 'asc' },
      });
    } catch (error) {
      throw new L0OperationError('Library document list failed', error);
    }
  }

  async insertFolder(
    row: Omit<LibraryFolderRecord, 'deletedAt'>,
  ): Promise<LibraryFolderRecord> {
    await this.database.connect();
    try {
      const created = await this.client().libraryFolder.create({
        data: {
          id: row.id,
          projectId: row.projectId,
          parentFolderId: row.parentFolderId,
          name: row.name,
          position: row.position,
        },
      });
      return toFolder(created);
    } catch (error) {
      throw uniqueOr('Library folder insert failed', error);
    }
  }

  async updateFolder(
    projectId: string,
    folderId: string,
    patch: {
      name?: string;
      parentFolderId?: string | null;
      position?: number;
    },
  ): Promise<LibraryFolderRecord | null> {
    await this.database.connect();
    try {
      const updated = await this.client().libraryFolder.updateMany({
        where: { id: folderId, projectId, deletedAt: null },
        data: patch,
      });
      if (updated.count === 0) {
        return null;
      }
      return this.findFolder(projectId, folderId);
    } catch (error) {
      throw uniqueOr('Library folder update failed', error);
    }
  }

  async findFolder(
    projectId: string,
    folderId: string,
  ): Promise<LibraryFolderRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().libraryFolder.findFirst({
        where: { id: folderId, projectId, deletedAt: null },
      });
      return row === null ? null : toFolder(row);
    } catch (error) {
      throw new L0OperationError('Library folder lookup failed', error);
    }
  }

  async listFolders(projectId: string): Promise<readonly LibraryFolderRecord[]> {
    await this.database.connect();
    try {
      const rows = await this.client().libraryFolder.findMany({
        where: { projectId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toFolder);
    } catch (error) {
      throw new L0OperationError('Library folder list failed', error);
    }
  }

  async deleteFolder(projectId: string, folderId: string): Promise<boolean> {
    await this.database.connect();
    try {
      const folders = await this.client().libraryFolder.findMany({
        where: { projectId },
        select: { id: true, parentFolderId: true, deletedAt: true },
      });
      const root = folders.find((folder) => folder.id === folderId && folder.deletedAt === null);
      if (root === undefined) {
        return false;
      }
      const removed = descendantFolderIds(folders satisfies readonly FolderNode[], folderId);
      const removedSet = new Set(removed);
      const items = await this.client().libraryItem.findMany({
        where: { projectId },
        select: {
          id: true,
          folderId: true,
          documentId: true,
          externalRecordId: true,
          deletedAt: true,
        },
      });
      const moves = filingMoves(items, removedSet);
      const now = new Date();
      const statements = [];
      if (moves.tombstone.length > 0) {
        statements.push(
          this.client().libraryItem.updateMany({
            where: { id: { in: [...moves.tombstone] } },
            data: { deletedAt: now, folderId: null },
          }),
        );
      }
      if (moves.root.length > 0) {
        statements.push(
          this.client().libraryItem.updateMany({
            where: { id: { in: [...moves.root] } },
            data: { folderId: null },
          }),
        );
      }
      statements.push(
        this.client().libraryFolder.updateMany({
          where: { id: { in: [...removed] } },
          data: { deletedAt: now },
        }),
      );
      await this.client().$transaction(statements);
      return true;
    } catch (error) {
      throw new L0OperationError('Library folder delete failed', error);
    }
  }

  async insertItem(row: Omit<LibraryItemRecord, 'deletedAt'>): Promise<LibraryItemRecord> {
    await this.database.connect();
    try {
      const created = await this.client().libraryItem.create({
        data: {
          id: row.id,
          projectId: row.projectId,
          folderId: row.folderId,
          documentId: row.documentId,
          externalRecordId: row.externalRecordId,
          position: row.position,
          metadata: row.metadata as Prisma.InputJsonValue,
        },
      });
      return toItem(created);
    } catch (error) {
      throw uniqueOr('Library item insert failed', error);
    }
  }

  async updateItem(
    projectId: string,
    itemId: string,
    patch: {
      folderId?: string | null;
      position?: number;
      metadata?: LibraryItemMetadata;
    },
  ): Promise<LibraryItemRecord | null> {
    await this.database.connect();
    try {
      const data: Prisma.LibraryItemUncheckedUpdateManyInput = {};
      if (patch.folderId !== undefined) {
        data.folderId = patch.folderId;
      }
      if (patch.position !== undefined) {
        data.position = patch.position;
      }
      if (patch.metadata !== undefined) {
        data.metadata = patch.metadata as Prisma.InputJsonValue;
      }
      const updated = await this.client().libraryItem.updateMany({
        where: { id: itemId, projectId, deletedAt: null },
        data,
      });
      if (updated.count === 0) {
        return null;
      }
      return this.findItem(projectId, itemId);
    } catch (error) {
      throw uniqueOr('Library item update failed', error);
    }
  }

  async findItem(projectId: string, itemId: string): Promise<LibraryItemRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().libraryItem.findFirst({
        where: { id: itemId, projectId, deletedAt: null },
      });
      return row === null ? null : toItem(row);
    } catch (error) {
      throw new L0OperationError('Library item lookup failed', error);
    }
  }

  async listItems(projectId: string): Promise<readonly LibraryItemRecord[]> {
    await this.database.connect();
    try {
      const rows = await this.client().libraryItem.findMany({
        where: { projectId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toItem);
    } catch (error) {
      throw new L0OperationError('Library item list failed', error);
    }
  }

  async deleteItem(projectId: string, itemId: string): Promise<boolean> {
    await this.database.connect();
    try {
      const updated = await this.client().libraryItem.updateMany({
        where: { id: itemId, projectId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return updated.count > 0;
    } catch (error) {
      throw new L0OperationError('Library item delete failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function toFolder(row: {
  id: string;
  projectId: string;
  parentFolderId: string | null;
  name: string;
  position: number;
  deletedAt: Date | null;
}): LibraryFolderRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    parentFolderId: row.parentFolderId,
    name: row.name,
    position: row.position,
    deletedAt: row.deletedAt,
  };
}

function toItem(row: {
  id: string;
  projectId: string;
  folderId: string | null;
  documentId: string | null;
  externalRecordId: string | null;
  position: number;
  metadata: Prisma.JsonValue;
  deletedAt: Date | null;
}): LibraryItemRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    folderId: row.folderId,
    documentId: row.documentId,
    externalRecordId: row.externalRecordId,
    position: row.position,
    metadata: readMetadata(row.metadata),
    deletedAt: row.deletedAt,
  };
}

export function bibliographyFromMetadata(metadata: Prisma.JsonValue | undefined): {
  title: string | null;
  authors: readonly string[];
  year: number | null;
} {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return { title: null, authors: [], year: null };
  }
  const record = metadata as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title : null;
  const year = typeof record.year === 'number' ? record.year : null;
  const authors = Array.isArray(record.authors)
    ? record.authors.filter((name): name is string => typeof name === 'string')
    : [];
  return { title, authors, year };
}

function readMetadata(metadata: Prisma.JsonValue): LibraryItemMetadata {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return {};
  }
  const note = (metadata as Record<string, unknown>).note;
  return typeof note === 'string' ? { note } : {};
}

function uniqueOr(message: string, error: unknown): L0OperationError {
  if (isUniqueViolation(error)) {
    return new L0OperationError('Library record already exists', error);
  }
  if (error instanceof L0OperationError) {
    return error;
  }
  return new L0OperationError(message, error);
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { code: unknown }).code;
  return code === 'P2002' || code === '23505';
}
