import { createStubAdapters } from '../../src/ai/adapters/stub/stub-adapters';
import type { CapabilityAdapter } from '../../src/ai/adapters/adapter.port';
import { MemoryObjectStorage } from './memory-object-storage';

export function stubAdaptersWithOcrObject(
  objectKey = 'uploads/doc.pdf',
  body: Buffer | string = '%PDF-1.4 stub',
): {
  readonly storage: MemoryObjectStorage;
  readonly adapters: readonly CapabilityAdapter[];
} {
  const storage = new MemoryObjectStorage();
  storage.put(objectKey, body);
  return { storage, adapters: createStubAdapters(storage) };
}
