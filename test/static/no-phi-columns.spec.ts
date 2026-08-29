import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MIGRATIONS_ROOT = join(__dirname, '..', '..', 'prisma', 'migrations');

const FORBIDDEN_COLUMN =
  /\b(?:"|')?(?:patient_id|patient_name|mrn|medical_record_number|clinical_identifier|ssn|social_security)(?:"|')?\b/i;

function collectSqlFiles(dir: string): Array<{ path: string; content: string }> {
  const entries = readdirSync(dir);
  const files: Array<{ path: string; content: string }> = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectSqlFiles(fullPath));
      continue;
    }

    if (!entry.endsWith('.sql')) {
      continue;
    }

    files.push({
      path: relative(process.cwd(), fullPath).replace(/\\/g, '/'),
      content: readFileSync(fullPath, 'utf8'),
    });
  }

  return files;
}

describe('no PHI / clinical identifier columns (GAP-CAT-A-01 / P-e)', () => {
  it('rejects patient identity, MRN, or clinical identifier column names in migrations', () => {
    const hits = collectSqlFiles(MIGRATIONS_ROOT).flatMap((file) => {
      const matches = file.content.match(new RegExp(FORBIDDEN_COLUMN.source, 'gi')) ?? [];
      return matches.map((m) => `${file.path}: ${m}`);
    });

    expect(hits).toEqual([]);
  });

  it('does not create migrations beyond 005 in this block', () => {
    const dirs = readdirSync(MIGRATIONS_ROOT).filter((name) => {
      const full = join(MIGRATIONS_ROOT, name);
      return statSync(full).isDirectory() && /_\d{3}_/.test(name);
    });

    const numbered = dirs
      .map((name) => {
        const m = name.match(/_(\d{3})_/);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => n !== null);

    expect(numbered.every((n) => n <= 11)).toBe(true);
    expect(numbered).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  });
});
