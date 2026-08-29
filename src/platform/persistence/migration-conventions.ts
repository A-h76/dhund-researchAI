/**
 * DHB-28 migration conventions (enforced by static tests):
 * - Schema-only migrations; no long-running product-data UPDATE backfills
 * - Backfills belong in jobs, not migrations
 * - No create_all / SQLite — PostgreSQL only via prisma migrate
 */

const FORBIDDEN_BACKFILL =
  /\bUPDATE\b[\s\S]{0,200}\b(SET\s+\w+\s*=|FROM\s+\w+)/i;

export function findForbiddenMigrationBackfills(
  files: Array<{ path: string; content: string }>,
): string[] {
  return files
    .filter((file) => file.path.replace(/\\/g, '/').includes('/migrations/'))
    .filter((file) => file.path.endsWith('.sql'))
    .filter((file) => FORBIDDEN_BACKFILL.test(file.content))
    .map((file) => file.path);
}
