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
  getPresignedPutUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getPresignedGetUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Read object bytes for worker-side processing (extract / OCR). */
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType?: string): Promise<void>;
}
