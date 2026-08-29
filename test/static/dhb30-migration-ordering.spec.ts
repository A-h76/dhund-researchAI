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

  it('does not create migrations beyond 011 in this block', () => {
    const numbered = migrationDirs()
      .map((name) => {
        const m = name.match(/_(\d{3})_/);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => n !== null);

    expect(numbered.every((n) => n <= 11)).toBe(true);
  });
});
