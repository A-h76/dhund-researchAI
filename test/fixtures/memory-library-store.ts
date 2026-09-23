import { L0OperationError } from '../../src/l0/ports/errors';
import {
  descendantFolderIds,
  filingMoves,
} from '../../src/l0/ports/library-folder-delete';
import type {
  LibraryDocumentTarget,
  LibraryExternalTarget,
  LibraryFolderRecord,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryStore,
} from '../../src/l0/ports/library.port';

interface StoredDocument extends LibraryDocumentTarget {
  readonly storageKey: string;
}

export class MemoryLibraryStore implements LibraryStore {
  readonly documents = new Map<string, StoredDocument>();
  readonly externals = new Map<string, LibraryExternalTarget>();
  readonly folders = new Map<string, LibraryFolderRecord>();
  readonly items = new Map<string, LibraryItemRecord>();

  seedDocument(row: StoredDocument): void {
    this.documents.set(row.id, row);
  }

  seedExternal(row: LibraryExternalTarget): void {
    this.externals.set(row.id, row);
  }

  async findDocument(projectId: string, documentId: string): Promise<LibraryDocumentTarget | null> {
    const row = this.documents.get(documentId);
    if (row === undefined || row.projectId !== projectId) {
      return null;
    }
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      authors: row.authors,
      year: row.year,
    };
  }

  async findExternal(
    projectId: string,
    externalRecordId: string,
  ): Promise<LibraryExternalTarget | null> {
    const row = this.externals.get(externalRecordId);
    if (row === undefined || row.projectId !== projectId) {
      return null;
    }
    return row;
  }

  async listDocuments(projectId: string): Promise<readonly LibraryDocumentTarget[]> {
    return [...this.documents.values()]
      .filter((row) => row.projectId === projectId)
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        authors: row.authors,
        year: row.year,
      }));
  }

  documentStorageKey(documentId: string): string | null {
    return this.documents.get(documentId)?.storageKey ?? null;
  }

  async insertFolder(row: Omit<LibraryFolderRecord, 'deletedAt'>): Promise<LibraryFolderRecord> {
    this.assertFolderNameFree(row.projectId, row.parentFolderId, row.name, null);
    const stored: LibraryFolderRecord = { ...row, deletedAt: null };
    this.folders.set(stored.id, stored);
    return stored;
  }

  async updateFolder(
    projectId: string,
    folderId: string,
    patch: { name?: string; parentFolderId?: string | null; position?: number },
  ): Promise<LibraryFolderRecord | null> {
    const current = await this.findFolder(projectId, folderId);
    if (current === null) {
      return null;
    }
    const next: LibraryFolderRecord = {
      ...current,
      name: patch.name ?? current.name,
      parentFolderId:
        patch.parentFolderId === undefined ? current.parentFolderId : patch.parentFolderId,
      position: patch.position ?? current.position,
    };
    this.assertFolderNameFree(projectId, next.parentFolderId, next.name, folderId);
    this.folders.set(folderId, next);
    return next;
  }

  async findFolder(projectId: string, folderId: string): Promise<LibraryFolderRecord | null> {
    const row = this.folders.get(folderId);
    if (row === undefined || row.projectId !== projectId || row.deletedAt !== null) {
      return null;
    }
    return row;
  }

  async listFolders(projectId: string): Promise<readonly LibraryFolderRecord[]> {
    return [...this.folders.values()].filter(
      (row) => row.projectId === projectId && row.deletedAt === null,
    );
  }

  async deleteFolder(projectId: string, folderId: string): Promise<boolean> {
    const folders = [...this.folders.values()].filter((row) => row.projectId === projectId);
    const root = folders.find((row) => row.id === folderId && row.deletedAt === null);
    if (root === undefined) {
      return false;
    }
    const removed = descendantFolderIds(folders, folderId);
    const removedSet = new Set(removed);
    const moves = filingMoves([...this.items.values()], removedSet);
    const now = new Date();
    for (const id of moves.tombstone) {
      const item = this.items.get(id);
      if (item !== undefined) {
        this.items.set(id, { ...item, deletedAt: now, folderId: null });
      }
    }
    for (const id of moves.root) {
      const item = this.items.get(id);
      if (item !== undefined) {
        this.items.set(id, { ...item, folderId: null });
      }
    }
    for (const id of removed) {
      const folder = this.folders.get(id);
      if (folder !== undefined) {
        this.folders.set(id, { ...folder, deletedAt: now });
      }
    }
    return true;
  }

  async insertItem(row: Omit<LibraryItemRecord, 'deletedAt'>): Promise<LibraryItemRecord> {
    this.assertItemFree(row);
    const stored: LibraryItemRecord = { ...row, deletedAt: null };
    this.items.set(stored.id, stored);
    return stored;
  }

  async updateItem(
    projectId: string,
    itemId: string,
    patch: { folderId?: string | null; position?: number; metadata?: LibraryItemMetadata },
  ): Promise<LibraryItemRecord | null> {
    const current = await this.findItem(projectId, itemId);
    if (current === null) {
      return null;
    }
    const next: LibraryItemRecord = {
      ...current,
      folderId: patch.folderId === undefined ? current.folderId : patch.folderId,
      position: patch.position ?? current.position,
      metadata: patch.metadata ?? current.metadata,
    };
    this.items.set(itemId, next);
    return next;
  }

  async findItem(projectId: string, itemId: string): Promise<LibraryItemRecord | null> {
    const row = this.items.get(itemId);
    if (row === undefined || row.projectId !== projectId || row.deletedAt !== null) {
      return null;
    }
    return row;
  }

  async listItems(projectId: string): Promise<readonly LibraryItemRecord[]> {
    return [...this.items.values()].filter(
      (row) => row.projectId === projectId && row.deletedAt === null,
    );
  }

  async deleteItem(projectId: string, itemId: string): Promise<boolean> {
    const current = await this.findItem(projectId, itemId);
    if (current === null) {
      return false;
    }
    this.items.set(itemId, { ...current, deletedAt: new Date() });
    return true;
  }

  private assertFolderNameFree(
    projectId: string,
    parentFolderId: string | null,
    name: string,
    exceptId: string | null,
  ): void {
    for (const folder of this.folders.values()) {
      if (
        folder.deletedAt === null &&
        folder.projectId === projectId &&
        folder.parentFolderId === parentFolderId &&
        folder.name === name &&
        folder.id !== exceptId
      ) {
        throw new L0OperationError('Library record already exists');
      }
    }
  }

  private assertItemFree(row: Omit<LibraryItemRecord, 'deletedAt'>): void {
    for (const item of this.items.values()) {
      if (item.deletedAt !== null || item.projectId !== row.projectId) {
        continue;
      }
      if (item.folderId !== row.folderId) {
        continue;
      }
      if (
        (row.documentId !== null && item.documentId === row.documentId) ||
        (row.externalRecordId !== null && item.externalRecordId === row.externalRecordId)
      ) {
        throw new L0OperationError('Library record already exists');
      }
    }
  }
}
