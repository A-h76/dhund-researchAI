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

function dhb30MigrationNumbers(): number[] {
  return migrationDirs()
    .map((name) => {
      const m = name.match(/_(\d{3})_/);
      return m ? Number(m[1]) : null;
    })
    .filter((n): n is number => n !== null && n >= 6 && n <= 11)
    .sort((a, b) => a - b);
}

describe('DHB-30 migration ordering hazards', () => {
  it('applies 006 before 011 in migration directory order', () => {
    const dirs = migrationDirs();
    const idx006 = dirs.findIndex((d) => d.includes('_006_'));
    const idx011 = dirs.findIndex((d) => d.includes('_011_'));
    expect(idx006).toBeGreaterThanOrEqual(0);
    expect(idx011).toBeGreaterThanOrEqual(0);
    expect(idx006).toBeLessThan(idx011);
  });

  it('006 ai ledger migration does not define research_runs FK or research_run_id column', () => {
    const dir = migrationDirs().find((d) => d.includes('_006_'));
    expect(dir).toBeDefined();
    const sql = readFileSync(join(MIGRATIONS_ROOT, dir!, 'migration.sql'), 'utf8')
      .replace(/--[^\n]*/g, '')
      .toLowerCase();
    expect(sql).not.toMatch(/research_runs/);
    expect(sql).not.toMatch(/research_run_id/);
  });

  it('includes migrations 006–011 exactly once in the DHB-30 block', () => {
    expect(dhb30MigrationNumbers()).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it('DHB-30 SQL in 006–011 does not reference tables owned by later migration blocks', () => {
    const laterTables = [
      'research_runs',
      'extraction_schemas',
      'screening_criteria',
      'outbox',
      'writings',
      'conversations',
      'library_folders',
      'connector_cache',
    ];

    for (const dir of migrationDirs().filter((d) => /_00[6-9]_|_01[01]_/.test(d))) {
      const sql = readFileSync(join(MIGRATIONS_ROOT, dir, 'migration.sql'), 'utf8')
        .replace(/--[^\n]*/g, '')
        .toLowerCase();
      for (const table of laterTables) {
        expect(sql).not.toMatch(new RegExp(`\\b${table}\\b`));
      }
    }
  });

  it('does not fail when migrations 012+ exist elsewhere in the repository', () => {
    const allNumbers = migrationDirs()
      .map((name) => {
        const m = name.match(/_(\d{3})_/);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => n !== null);

    expect(allNumbers.some((n) => n >= 12)).toBe(true);
    expect(dhb30MigrationNumbers()).toEqual([6, 7, 8, 9, 10, 11]);
  });
});
