import { DomainError, ErrorCode } from '../platform/errors';
import {
  ALLOWED_UPLOAD_MIME_TYPE,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILENAME_CHARS,
  PDF_MAGIC,
} from './upload.constants';

const MODULE = 'ingestion';

export function assertUploadFilename(filename: string): void {
  if (filename.includes('\0')) {
    throw new DomainError(ErrorCode.InvalidFilename, { module: MODULE });
  }
  const base = filename.split(/[/\\]/).pop() ?? '';
  if (base.length === 0 || base.length > MAX_UPLOAD_FILENAME_CHARS) {
    throw new DomainError(ErrorCode.InvalidFilename, { module: MODULE });
  }
  if (!filename.includes('/') && !filename.includes('\\') && filename.length > MAX_UPLOAD_FILENAME_CHARS) {
    throw new DomainError(ErrorCode.InvalidFilename, { module: MODULE });
  }
}

export function assertAllowedMimeType(mimeType: string): void {
  if (mimeType !== ALLOWED_UPLOAD_MIME_TYPE) {
    throw new DomainError(ErrorCode.InvalidFileType, { module: MODULE });
  }
}

export function assertUploadSize(sizeBytes: number): void {
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new DomainError(ErrorCode.FileTooLarge, { module: MODULE });
  }
}

export function assertPdfMagicBytes(bytes: Buffer, declaredMimeType: string): void {
  if (declaredMimeType !== ALLOWED_UPLOAD_MIME_TYPE) {
    throw new DomainError(ErrorCode.InvalidFileType, { module: MODULE });
  }
  if (
    bytes.length < PDF_MAGIC.length ||
    !bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
  ) {
    throw new DomainError(ErrorCode.MagicBytesMismatch, { module: MODULE });
  }
}

export function storedFilenameFromKey(storageKey: string): string {
  const segment = storageKey.split('/').pop();
  return segment !== undefined && segment.length > 0 ? segment : 'file';
}
