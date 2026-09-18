import { AdapterError } from '../adapter.errors';
import type { ObjectStorageService } from '../../../l0/ports/object-storage.port';

export const OCR_PRESIGN_TTL_SECONDS = 120;
export const OCR_OBJECT_MAX_BYTES = 50 * 1024 * 1024;

export async function loadOcrObject(
  storage: ObjectStorageService,
  objectKey: string,
): Promise<Buffer> {
  await storage.getPresignedGetUrl(objectKey, OCR_PRESIGN_TTL_SECONDS);
  const bytes = await storage.getObjectBytes(objectKey, OCR_OBJECT_MAX_BYTES);
  if (bytes === null || bytes.byteLength === 0) {
    throw new AdapterError('terminal', 'OCR object missing');
  }
  return bytes;
}
