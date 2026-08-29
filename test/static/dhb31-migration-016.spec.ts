import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_ROOT = join(__dirname, '..', '..', 'prisma', 'migrations');

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS_ROOT)
    .filter((name) => {
      const full = join(MIGRATIONS_ROOT, name);
      return statSync(full).isDirectory() && /_\d{3}_/.test(name);
    })
    .sort();
}

function readMigrationSql(dirFragment: string): string {
  const dir = migrationDirs().find((d) => d.includes(dirFragment));
  expect(dir).toBeDefined();
  return readFileSync(join(MIGRATIONS_ROOT, dir!, 'migration.sql'), 'utf8');
}

describe('DHB-31 migration 016 (FTS)', () => {
  it('applies 016 after 011 in migration directory order', () => {
    const dirs = migrationDirs();
    const idx011 = dirs.findIndex((d) => d.includes('_011_'));
    const idx016 = dirs.findIndex((d) => d.includes('_016_'));
    expect(idx011).toBeGreaterThanOrEqual(0);
    expect(idx016).toBeGreaterThanOrEqual(0);
    expect(idx011).toBeLessThan(idx016);
  });

  it('does not add FTS DDL to migration 009 ingestion', () => {
    const sql009 = readMigrationSql('_009_');
    const ddl = sql009.replace(/--[^\n]*/g, '').toLowerCase();

    expect(ddl).not.toMatch(/add column "text"/);
    expect(ddl).not.toMatch(/generated always as \(to_tsvector/);
    expect(ddl).not.toMatch(/create index "idx_chunks_fts"/);
  });

  it('does not create a second HNSW index in migration 016', () => {
    const sql016 = readMigrationSql('_016_');
    expect(sql016.toLowerCase()).not.toMatch(/hnsw/);
    expect(sql016.toLowerCase()).not.toMatch(/chunk_embeddings/);
  });

  it('adds chunks.text, generated search_vector, GIN FTS, and document trigram indexes', () => {
    const sql016 = readMigrationSql('_016_').replace(/--[^\n]*/g, '').toLowerCase();

    expect(sql016).toMatch(/alter table "chunks" add column "text"/);
    expect(sql016).toMatch(/generated always as \(to_tsvector\('english', "text"\)\) stored/);
    expect(sql016).toMatch(/create index "idx_chunks_fts"/);
    expect(sql016).toMatch(/using gin \("search_vector"\)/);
    expect(sql016).toMatch(/create index "idx_documents_title_trgm"/);
    expect(sql016).toMatch(/create index "idx_documents_authors_trgm"/);
    expect(sql016).toMatch(/gin_trgm_ops/);
  });
});
