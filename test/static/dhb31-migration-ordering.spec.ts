import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_ROOT = join(__dirname, '..', '..', 'prisma', 'migrations');
const DHB31_BLOCK = [12, 13, 14, 15, 16, 17, 18, 19, 20] as const;

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS_ROOT)
    .filter((name) => {
      const full = join(MIGRATIONS_ROOT, name);
      return statSync(full).isDirectory() && /_\d{3}_/.test(name);
    })
    .sort();
}

function migrationNumber(name: string): number | null {
  const m = name.match(/_(\d{3})_/);
  return m ? Number(m[1]) : null;
}

function dhb31Dirs(): string[] {
  return migrationDirs().filter((d) => {
    const n = migrationNumber(d);
    return n !== null && n >= 12 && n <= 20;
  });
}

function readMigrationSql(dirFragment: string): string {
  const dir = migrationDirs().find((d) => d.includes(dirFragment));
  expect(dir).toBeDefined();
  return readFileSync(join(MIGRATIONS_ROOT, dir!, 'migration.sql'), 'utf8');
}

describe('DHB-31 migration ordering (012–020 block)', () => {
  it('includes every migration 012–020 exactly once', () => {
    const numbers = dhb31Dirs()
      .map((d) => migrationNumber(d)!)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([...DHB31_BLOCK]);
  });

  it('applies 012–020 in prisma directory order (012 before 016 before 017)', () => {
    const dirs = migrationDirs();
    const idx012 = dirs.findIndex((d) => d.includes('_012_'));
    const idx016 = dirs.findIndex((d) => d.includes('_016_'));
    const idx017 = dirs.findIndex((d) => d.includes('_017_'));
    expect(idx012).toBeGreaterThanOrEqual(0);
    expect(idx016).toBeGreaterThanOrEqual(0);
    expect(idx017).toBeGreaterThanOrEqual(0);
    expect(idx012).toBeLessThan(idx016);
    expect(idx016).toBeLessThan(idx017);
  });

  it('does not duplicate any migration number in the DHB-31 block', () => {
    const numbers = dhb31Dirs().map((d) => migrationNumber(d)!);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('016 remains the FTS migration', () => {
    const sql016 = readMigrationSql('_016_').replace(/--[^\n]*/g, '').toLowerCase();
    expect(sql016).toMatch(/to_tsvector\('english', "text"\)/);
    expect(sql016).toMatch(/idx_chunks_fts/);
    expect(sql016).not.toMatch(/hnsw/);
  });

  it('012–015 do not introduce writing, conversation, library, or connector tables', () => {
    const earlyBlock = ['_012_', '_013_', '_014_', '_015_'];
    const forbidden = ['writings', 'conversations', 'library_folders', 'connector_cache'];

    for (const fragment of earlyBlock) {
      const sql = readMigrationSql(fragment).replace(/--[^\n]*/g, '').toLowerCase();
      for (const table of forbidden) {
        expect(sql).not.toMatch(new RegExp(`create table "${table}"`));
      }
    }
  });

  it('017–020 do not duplicate orchestration, extraction, screening, or platform tables', () => {
    const lateBlock = ['_017_', '_018_', '_019_', '_020_'];
    const forbidden = [
      'research_runs',
      'extraction_schemas',
      'screening_criteria',
      'outbox',
      'audit_events',
    ];

    for (const fragment of lateBlock) {
      const sql = readMigrationSql(fragment).replace(/--[^\n]*/g, '').toLowerCase();
      for (const table of forbidden) {
        expect(sql).not.toMatch(new RegExp(`create table "${table}"`));
      }
    }
  });

  it('006 migration SQL still has no research_run_id expand step', () => {
    const sql006 = readMigrationSql('_006_').replace(/--[^\n]*/g, '').toLowerCase();
    expect(sql006).not.toMatch(/research_run_id/);
  });

  it('012 adds research_runs and ai_executions.research_run_id FK', () => {
    const sql012 = readMigrationSql('_012_').replace(/--[^\n]*/g, '').toLowerCase();
    expect(sql012).toMatch(/create table "research_runs"/);
    expect(sql012).toMatch(/alter table "ai_executions" add column "research_run_id"/);
    expect(sql012).toMatch(/ai_executions_research_run_id_fkey/);
  });

  it('011 citations migration does not add writings FK before 017', () => {
    const sql011 = readMigrationSql('_011_').replace(/--[^\n]*/g, '').toLowerCase();
    expect(sql011).not.toMatch(/citations_writing_id_fkey/);
    expect(sql011).not.toMatch(/references "writings"/);
  });

  it('017 adds writings.current_version_id FK after writing_versions', () => {
    const sql017 = readMigrationSql('_017_').replace(/--[^\n]*/g, '').toLowerCase();
    const writingsIdx = sql017.indexOf('create table "writings"');
    const versionsIdx = sql017.indexOf('create table "writing_versions"');
    const fkIdx = sql017.indexOf('writings_current_version_id_fkey');
    const citationsFkIdx = sql017.indexOf('citations_writing_id_fkey');
    expect(writingsIdx).toBeGreaterThanOrEqual(0);
    expect(versionsIdx).toBeGreaterThan(writingsIdx);
    expect(fkIdx).toBeGreaterThan(versionsIdx);
    expect(citationsFkIdx).toBeGreaterThan(fkIdx);
  });
});
