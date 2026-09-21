import { L0ConnectionError, L0OperationError } from '../../src/l0/ports/errors';
import type {
  ObjectStorageListing,
  ObjectStorageService,
  ObjectStorageStat,
} from '../../src/l0/ports/object-storage.port';
import { generateObjectKey } from '../../src/l0/adapters/s3-compatible/object-key.util';

interface StoredObject {
  readonly body: Buffer;
  readonly lastModified: Date;
}

export class MemoryObjectStorage implements ObjectStorageService {
  readonly objects = new Map<string, StoredObject>();
  failDeletes = false;
  failPuts = false;
  failReads = false;
  failLists = false;

  async connect(): Promise<void> {
    return;
  }

  async disconnect(): Promise<void> {
    return;
  }

  generateObjectKey(
    orgId: string,
    projectId: string,
    category: string,
    id: string,
    filename: string,
  ): string {
    return generateObjectKey(orgId, projectId, category, id, filename);
  }

  async getPresignedPutUrl(
    key: string,
    _expiresInSeconds?: number,
    _contentLength?: number,
  ): Promise<string> {
    if (this.failPuts) {
      throw new L0ConnectionError('Object storage connection failed');
    }
    return `memory://put/${key}`;
  }

  async getPresignedGetUrl(key: string, _expiresInSeconds?: number): Promise<string> {
    return `memory://get/${key}`;
  }

  async putObject(key: string, body: Buffer, _contentType?: string): Promise<void> {
    if (this.failPuts) {
      throw new L0ConnectionError('Object storage connection failed');
    }
    this.objects.set(key, { body, lastModified: new Date() });
  }

  async headObject(key: string): Promise<ObjectStorageStat | null> {
    if (this.failReads) {
      throw new L0ConnectionError('Object storage connection failed');
    }
    const stored = this.objects.get(key);
    if (stored === undefined) {
      return null;
    }
    return { contentLength: stored.body.byteLength };
  }

  async getObjectBytes(key: string, maxBytes: number): Promise<Buffer | null> {
    if (this.failReads) {
      throw new L0ConnectionError('Object storage connection failed');
    }
    const stored = this.objects.get(key);
    if (stored === undefined) {
      return null;
    }
    return stored.body.subarray(0, Math.max(0, maxBytes));
  }

  async delete(key: string): Promise<void> {
    if (this.failDeletes) {
      throw new L0OperationError('Object delete failed');
    }
    this.objects.delete(key);
  }

  async listKeys(prefix: string): Promise<readonly string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }

  async listObjects(prefix: string): Promise<readonly ObjectStorageListing[]> {
    if (this.failLists) {
      throw new L0OperationError('Object list failed');
    }
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, stored]) => ({
        key,
        lastModified: stored.lastModified,
        size: stored.body.byteLength,
      }));
  }

  put(key: string, body: string | Buffer = 'payload', lastModified: Date = new Date()): void {
    const buffer = typeof body === 'string' ? Buffer.from(body) : body;
    this.objects.set(key, { body: buffer, lastModified });
  }
}
