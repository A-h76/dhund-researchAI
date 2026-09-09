import { DomainError, ErrorCode } from '../../src/platform/errors';
import { MAX_UPLOAD_BYTES } from '../../src/ingestion/upload.constants';
import {
  assertAllowedMimeType,
  assertPdfMagicBytes,
  assertUploadFilename,
  assertUploadSize,
  storedFilenameFromKey,
} from '../../src/ingestion/upload-validation';
import { parseUploadCreateRequest } from '../../src/ingestion/parse-upload-request';

describe('DHB-48 upload validation', () => {
  it('sanitises path-traversal filenames without rejecting them', () => {
    expect(() => assertUploadFilename('../../etc/passwd')).not.toThrow();
    expect(storedFilenameFromKey('org/proj/uploads/id/passwd')).toBe('passwd');
  });

  it('rejects null bytes and overlong names', () => {
    expect(() => assertUploadFilename('evil\0.pdf')).toThrow(DomainError);
    try {
      assertUploadFilename('evil\0.pdf');
    } catch (error) {
      expect((error as DomainError).code).toBe(ErrorCode.InvalidFilename);
    }
    expect(() => assertUploadFilename(`${'a'.repeat(256)}.pdf`)).toThrow(DomainError);
  });

  it('rejects undeclared MIME types and oversized files', () => {
    expect(() => assertAllowedMimeType('application/zip')).toThrow(DomainError);
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES + 1)).toThrow(DomainError);
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES)).not.toThrow();
  });

  it('rejects application/pdf whose magic bytes are not PDF', () => {
    expect(() =>
      assertPdfMagicBytes(Buffer.from('not-a-pdf'), 'application/pdf'),
    ).toThrow(DomainError);
    try {
      assertPdfMagicBytes(Buffer.from('not-a-pdf'), 'application/pdf');
    } catch (error) {
      expect((error as DomainError).code).toBe(ErrorCode.MagicBytesMismatch);
    }
    expect(() =>
      assertPdfMagicBytes(Buffer.from('%PDF-1.7'), 'application/pdf'),
    ).not.toThrow();
  });

  it('parses create bodies and maps 51MB to file_too_large', () => {
    const parsed = parseUploadCreateRequest({
      filename: 'paper.pdf',
      mimeType: 'Application/PDF',
      sizeBytes: 1024,
    });
    expect(parsed.mimeType).toBe('application/pdf');
    try {
      parseUploadCreateRequest({
        filename: 'paper.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 51 * 1024 * 1024,
      });
      throw new Error('expected reject');
    } catch (error) {
      expect((error as DomainError).code).toBe(ErrorCode.FileTooLarge);
    }
  });
});
