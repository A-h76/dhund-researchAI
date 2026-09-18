import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUEUE_NAMES } from '../../src/platform/queues/queue-names';
import { UPLOAD_CONCURRENCY_DEFAULT } from '../../src/platform/concurrency';
import { MAX_UPLOAD_BYTES } from '../../src/ingestion/upload.constants';

const ROOT = join(__dirname, '..', '..');

describe('DHB-48 upload session static checks', () => {
  const controller = readFileSync(
    join(ROOT, 'src/ingestion/uploads.controller.ts'),
    'utf8',
  );
  const service = readFileSync(
    join(ROOT, 'src/ingestion/uploads.service.ts'),
    'utf8',
  );
  const storagePort = readFileSync(
    join(ROOT, 'src/l0/ports/object-storage.port.ts'),
    'utf8',
  );
  const adapter = readFileSync(
    join(ROOT, 'src/l0/adapters/s3-compatible/s3-object-storage.adapter.ts'),
    'utf8',
  );

  it('exposes both upload endpoints with project-role and auth guards', () => {
    expect(controller).toContain("@Post('v1/projects/:projectId/uploads')");
    expect(controller).toContain("@RequireProjectRole('EDITOR')");
    expect(controller).toContain("@Post('v1/uploads/:sessionId/complete')");
    expect(controller).toContain('@RequireAuth()');
  });

  it('mints server-generated keys, validates on complete, and enqueues extract', () => {
    expect(service).toContain('generateObjectKey');
    expect(service).toContain('UPLOAD_OBJECT_CATEGORY');
    expect(service).toContain('assertPdfMagicBytes');
    expect(service).toContain('requestExtractJob');
    expect(service).toContain('insertIssued');
    expect(service).not.toContain('body.projectId');
  });

  it('enforces ContentLength on the presigned PUT and never logs bucket hosts', () => {
    expect(storagePort).toContain('contentLength?: number');
    expect(storagePort).toContain('headObject');
    expect(storagePort).toContain('getObjectBytes');
    expect(adapter).toContain('ContentLength: contentLength');
    expect(service).not.toMatch(/bucket|minio|amazonaws|endpoint/i);
    expect(adapter).not.toContain('${this.bucket}');
  });

  it('keeps the R1 size ceiling, upload concurrency, and queue count unchanged', () => {
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
    expect(UPLOAD_CONCURRENCY_DEFAULT).toBe(5);
    expect(QUEUE_NAMES).toHaveLength(25);
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb48'))).toBe(
      false,
    );
  });
});
