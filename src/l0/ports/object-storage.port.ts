export interface ObjectStorageStat {
  readonly contentLength: number;
}

export interface ObjectStorageListing {
  readonly key: string;
  readonly lastModified: Date;
  readonly size: number;
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
  /** Server-side put for connector-fetched bytes (not client uploads). */
  putObject(key: string, body: Buffer, contentType?: string): Promise<void>;
  headObject(key: string): Promise<ObjectStorageStat | null>;
  getObjectBytes(key: string, maxBytes: number): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  listKeys(prefix: string): Promise<readonly string[]>;
  listObjects(prefix: string): Promise<readonly ObjectStorageListing[]>;
}

