import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUEUE_NAMES } from '../../src/platform/queues/queue-names';
import { QUEUE_REGISTRY } from '../../src/platform/queues/queue-registry';
import { ORPHAN_SWEEP_INTERVAL_MS } from '../../src/platform/persistence/orphan-sweep.constants';

const ROOT = join(__dirname, '..', '..');

describe('DHB-49 document lifecycle static checks', () => {
  const accessController = readFileSync(
    join(ROOT, 'src/ingestion/document-access.controller.ts'),
    'utf8',
  );
  const documentsService = readFileSync(
    join(ROOT, 'src/ingestion/documents.service.ts'),
    'utf8',
  );
  const documentsRepository = readFileSync(
    join(ROOT, 'src/ingestion/documents.repository.ts'),
    'utf8',
  );
  const scopedAdapter = readFileSync(
    join(ROOT, 'src/l0/adapters/prisma/prisma-scoped-store.adapter.ts'),
    'utf8',
  );
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const sweepAdapter = readFileSync(
    join(ROOT, 'src/l0/adapters/prisma/prisma-orphan-sweep.adapter.ts'),
    'utf8',
  );
  const sweepService = readFileSync(
    join(ROOT, 'src/platform/persistence/orphan-sweep.service.ts'),
    'utf8',
  );

  it('exposes status, download, and delete under /v1/documents/:id', () => {
    expect(accessController).toContain("@Controller('v1/documents')");
    expect(accessController).toContain("@Get(':id/status')");
    expect(accessController).toContain("@Get(':id/download')");
    expect(accessController).toContain("@Delete(':id')");
    expect(accessController).toContain('@RequireAuth()');
  });

  it('returns stored status honestly and never maps partial to completed', () => {
    expect(documentsService).toContain('status: document.status');
    expect(documentsService).not.toMatch(/status:\s*['"]completed['"]/);
    expect(documentsService).toContain('document.storageKey');
    expect(documentsService).not.toMatch(/storageKey:/);
    expect(documentsService).toContain('getPresignedGetUrl');
    expect(documentsService).toContain("enqueue('orphan-sweep'");
  });

  it('tombstones documents without hard-deleting chunks or embeddings', () => {
    expect(scopedAdapter).toContain("'document'");
    expect(scopedAdapter).toContain('deletedAt: new Date()');
    expect(documentsRepository).toContain("this.reader.remove('document'");
    expect(documentsRepository).not.toContain('chunk.delete');
    expect(documentsService).not.toContain('chunk.delete');
    expect(sweepAdapter).toContain('retiredAt: new Date()');
    expect(sweepAdapter).toContain('documentVersion.create');
    expect(sweepAdapter).not.toContain('chunk.delete');
    expect(schema).toContain('chunk_id');
    expect(schema).toContain('onDelete: Cascade');
  });

  it('keeps orphan-sweep on the existing singleton queue and aborts on incomplete ownership', () => {
    expect(QUEUE_NAMES).toHaveLength(25);
    expect(QUEUE_NAMES).toContain('orphan-sweep');
    expect(QUEUE_REGISTRY['orphan-sweep'].attempts).toEqual({ kind: 'fixed', attempts: 1 });
    expect(ORPHAN_SWEEP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(sweepService).toContain("recordAbort('ownership_incomplete')");
    expect(sweepService).toContain("recordAbort('list_failed')");
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb49'))).toBe(
      false,
    );
  });
});
