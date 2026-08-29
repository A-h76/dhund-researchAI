import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findForbiddenMigrationBackfills } from '../../src/platform/persistence/migration-conventions';

const MIGRATIONS_ROOT = join(__dirname, '..', '..', 'prisma', 'migrations');

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

describe('migration conventions (DHB-28)', () => {
  it('does not contain long-running product-data UPDATE backfills', () => {
    expect(findForbiddenMigrationBackfills(collectSqlFiles(MIGRATIONS_ROOT))).toEqual(
      [],
    );
  });

  it('detects a forbidden backfill pattern', () => {
    expect(
      findForbiddenMigrationBackfills([
        {
          path: 'prisma/migrations/x/migration.sql',
          content: 'UPDATE users SET status = \'done\' FROM staging;',
        },
      ]),
    ).toEqual(['prisma/migrations/x/migration.sql']);
  });
});
