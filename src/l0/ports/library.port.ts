export const LIBRARY_STORE = Symbol('LIBRARY_STORE');

export interface LibraryDocumentTarget {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly year: number | null;
}

export interface LibraryExternalTarget {
  readonly id: string;
  readonly projectId: string;
  readonly title: string | null;
  readonly authors: readonly string[];
  readonly year: number | null;
}

export interface LibraryFolderRecord {
  readonly id: string;
  readonly projectId: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly position: number;
  readonly deletedAt: Date | null;
}

export interface LibraryItemMetadata {
  readonly note?: string;
}

export interface LibraryItemRecord {
  readonly id: string;
  readonly projectId: string;
  readonly folderId: string | null;
  readonly documentId: string | null;
  readonly externalRecordId: string | null;
  readonly position: number;
  readonly metadata: LibraryItemMetadata;
  readonly deletedAt: Date | null;
}

export interface LibraryStore {
  findDocument(projectId: string, documentId: string): Promise<LibraryDocumentTarget | null>;
  findExternal(
    projectId: string,
    externalRecordId: string,
  ): Promise<LibraryExternalTarget | null>;
  listDocuments(projectId: string): Promise<readonly LibraryDocumentTarget[]>;
  insertFolder(
    row: Omit<LibraryFolderRecord, 'deletedAt'>,
  ): Promise<LibraryFolderRecord>;
  updateFolder(
    projectId: string,
    folderId: string,
    patch: {
      name?: string;
      parentFolderId?: string | null;
      position?: number;
    },
  ): Promise<LibraryFolderRecord | null>;
  findFolder(projectId: string, folderId: string): Promise<LibraryFolderRecord | null>;
  listFolders(projectId: string): Promise<readonly LibraryFolderRecord[]>;
  deleteFolder(projectId: string, folderId: string): Promise<boolean>;
  insertItem(row: Omit<LibraryItemRecord, 'deletedAt'>): Promise<LibraryItemRecord>;
  updateItem(
    projectId: string,
    itemId: string,
    patch: {
      folderId?: string | null;
      position?: number;
      metadata?: LibraryItemMetadata;
    },
  ): Promise<LibraryItemRecord | null>;
  findItem(projectId: string, itemId: string): Promise<LibraryItemRecord | null>;
  listItems(projectId: string): Promise<readonly LibraryItemRecord[]>;
  deleteItem(projectId: string, itemId: string): Promise<boolean>;
}
