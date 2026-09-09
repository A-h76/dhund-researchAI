export interface LiveDocumentRecord {
  readonly id: string;
  readonly projectId: string;
  readonly orgId: string;
  readonly status: string;
  readonly storageKey: string;
}

export type OwnedStorageKeysResult =
  | { readonly ok: true; readonly keys: ReadonlySet<string> }
  | { readonly ok: false };

export interface NewDocumentVersionInput {
  readonly id: string;
  readonly documentId: string;
  readonly versionNo: number;
  readonly storageKey: string;
}

export interface OrphanSweepStore {
  findLiveById(id: string): Promise<LiveDocumentRecord | null>;
  listOwnedStorageKeys(): Promise<OwnedStorageKeysResult>;
  retireVersion(versionId: string): Promise<boolean>;
  addVersion(input: NewDocumentVersionInput): Promise<void>;
  countChunksForDocument(documentId: string): Promise<number>;
  countEmbeddingsForDocument(documentId: string): Promise<number>;
}
