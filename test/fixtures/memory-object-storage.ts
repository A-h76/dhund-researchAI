import { L0ConnectionError, L0OperationError } from '../../src/l0/ports/errors';
import type {
  ObjectStorageService,
  ObjectStorageStat,
} from '../../src/l0/ports/object-storage.port';
import { generateObjectKey } from '../../src/l0/adapters/s3-compatible/object-key.util';

export class MemoryObjectStorage implements ObjectStorageService {
  readonly objects = new Map<string, Buffer>();
  failDeletes = false;
  failPuts = false;
  failReads = false;

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

  async getPresignedGetUrl(key: string): Promise<string> {
    return `memory://get/${key}`;
  }

  async headObject(key: string): Promise<ObjectStorageStat | null> {
    if (this.failReads) {
      throw new L0ConnectionError('Object storage connection failed');
    }
    const body = this.objects.get(key);
    if (body === undefined) {
      return null;
    }
    return { contentLength: body.byteLength };
  }

  async getObjectBytes(key: string, maxBytes: number): Promise<Buffer | null> {
    if (this.failReads) {
      throw new L0ConnectionError('Object storage connection failed');
    }
    const body = this.objects.get(key);
    if (body === undefined) {
      return null;
    }
    return body.subarray(0, Math.max(0, maxBytes));
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

  put(key: string, body: string | Buffer = 'payload'): void {
    this.objects.set(key, typeof body === 'string' ? Buffer.from(body) : body);
  }
}
