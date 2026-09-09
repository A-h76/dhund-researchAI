import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUEUE_NAMES } from '../../src/platform/queues/queue-names';
import { BACKUP_RETENTION_DAYS } from '../../src/l0/ports/project-erasure.port';

const ROOT = join(__dirname, '..', '..');

describe('DHB-39 GAP-CAT-A-01 (P-f) / E19 deletion-erasure', () => {
  const erasure = readFileSync(
    join(ROOT, 'src/platform/persistence/project-erasure.service.ts'),
    'utf8',
  );
  const adapter = readFileSync(
    join(ROOT, 'src/l0/adapters/prisma/prisma-project-erasure.adapter.ts'),
    'utf8',
  );
  const tenancy = readFileSync(
    join(ROOT, 'src/projects/tenancy.service.ts'),
    'utf8',
  );
  const storagePort = readFileSync(
    join(ROOT, 'src/l0/ports/object-storage.port.ts'),
    'utf8',
  );
  const queues = readFileSync(
    join(ROOT, 'src/platform/queues/queue-names.ts'),
    'utf8',
  );
  const runbook = readFileSync(
    join(ROOT, 'docs/runbooks/project-erasure.md'),
    'utf8',
  );
  const trigger = readFileSync(
    join(ROOT, 'prisma/migrations/20250829131140_015_platform/migration.sql'),
    'utf8',
  );

  it('keeps tombstone-then-job ordering and does not shred on the request path', () => {
    expect(tenancy).toContain('projects.project.deleted');
    expect(tenancy).toContain('softDeleteProject');
    expect(tenancy).not.toContain('OBJECT_STORAGE_SERVICE');
    expect(tenancy).not.toContain('.delete(');
  });

  it('crypto-shreds through ObjectStorageService.delete and retains audit rows', () => {
    expect(storagePort).toContain('delete(key: string)');
    expect(erasure).toContain('this.storage.delete');
    expect(erasure).not.toContain('auditEvent.delete');
    expect(adapter).toContain("SET actor_id = NULL");
    expect(adapter).not.toContain('DELETE FROM audit_events');
    expect(trigger).toContain('DELETE rejected: append-only table audit_events');
  });

  it('documents the 30-day backup tail and never claims instant erasure', () => {
    expect(BACKUP_RETENTION_DAYS).toBe(30);
    expect(runbook).toContain('30 days');
    expect(runbook).toContain('WA-f');
    expect(erasure).toContain('erasureComplete');
    expect(erasure).toContain('backupTailEndsAt');
  });

  it('does not add a 26th queue or a schema migration', () => {
    expect(QUEUE_NAMES).toHaveLength(25);
    expect(queues).not.toContain('project-deletion');
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb39'))).toBe(
      false,
    );
  });
});
