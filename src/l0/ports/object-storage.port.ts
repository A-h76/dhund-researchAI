export interface ObjectStorageStat {
  readonly contentLength: number;
}

export interface ObjectStorageService {
  connect(correlationId?: string): Promise<void>;
  disconnect(correlationId?: string): Promise<void>;
  generateObjectKey(
    orgId: string,
    projectId: string,
    category: string,
    id: string,
    filename: string,
  ): string;
  getPresignedPutUrl(
    key: string,
    expiresInSeconds?: number,
    contentLength?: number,
  ): Promise<string>;
  getPresignedGetUrl(key: string, expiresInSeconds?: number): Promise<string>;
  headObject(key: string): Promise<ObjectStorageStat | null>;
  getObjectBytes(key: string, maxBytes: number): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  listKeys(prefix: string): Promise<readonly string[]>;
}
