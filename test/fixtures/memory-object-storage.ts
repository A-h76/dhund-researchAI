import { L0OperationError } from '../../src/l0/ports/errors';
import type { ObjectStorageService } from '../../src/l0/ports/object-storage.port';

export class MemoryObjectStorage implements ObjectStorageService {
  readonly objects = new Map<string, string>();
  failDeletes = false;

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
    return `${orgId}/${projectId}/${category}/${id}/${filename}`;
  }

  async getPresignedPutUrl(key: string): Promise<string> {
    return `memory://put/${key}`;
  }

  async getPresignedGetUrl(key: string): Promise<string> {
    return `memory://get/${key}`;
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

  put(key: string, body = 'payload'): void {
    this.objects.set(key, body);
  }
}
