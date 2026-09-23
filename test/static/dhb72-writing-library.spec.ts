import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

describe('DHB-72 GAP-LIB-01 / GAP-WRITING-01 static contracts', () => {
  it('stores no bibliographic columns on library_items and keeps note in metadata', () => {
    const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model LibraryItem {'), schema.indexOf('model ConnectorCache'));
    expect(model).toContain('metadata');
    expect(model).not.toMatch(/^\s+title\s/m);
    expect(model).not.toMatch(/^\s+authors\s/m);
    expect(model).not.toMatch(/^\s+year\s/m);
    expect(model).not.toMatch(/^\s+note\s/m);
    expect(model).not.toMatch(/download/i);
  });

  it('rejects writing_versions updates in the database and exposes no writing mutation route', () => {
    const migration = readFileSync(
      join(ROOT, 'prisma', 'migrations', '20250829131700_017_writing', 'migration.sql'),
      'utf8',
    );
    expect(migration).toContain('trg_writing_versions_reject_update');
    const controller = readFileSync(
      join(ROOT, 'src', 'apps', 'api', 'writing-sentence-bindings.controller.ts'),
      'utf8',
    );
    expect(controller).not.toMatch(/@Post|@Patch|@Put|@Delete/);
    const persistence = readFileSync(
      join(ROOT, 'src', 'evidence', 'writing-persistence.service.ts'),
      'utf8',
    );
    expect(persistence).toContain('Writing versions are immutable');
    expect(persistence).not.toMatch(/writingVersion\.update/);
  });

  it('keeps library responses free of bytes and download URLs', () => {
    const service = readFileSync(join(ROOT, 'src', 'ingestion', 'library.service.ts'), 'utf8');
    expect(service).not.toMatch(/downloadUrl|storageKey|bytes/);
    const adapter = readFileSync(
      join(ROOT, 'src', 'l0', 'adapters', 'prisma', 'prisma-library.adapter.ts'),
      'utf8',
    );
    expect(adapter).toContain('descendantFolderIds');
    expect(adapter).toContain('filingMoves');
    expect(adapter).not.toMatch(/storageKey|downloadUrl/);
    const writing = readFileSync(
      join(ROOT, 'src', 'l0', 'adapters', 'prisma', 'prisma-writing-store.adapter.ts'),
      'utf8',
    );
    const messages = readFileSync(
      join(ROOT, 'src', 'l0', 'adapters', 'prisma', 'prisma-message-evidence-binding.adapter.ts'),
      'utf8',
    );
    expect(writing).toContain('disjoint');
    expect(messages).toContain('disjoint');
  });
});
