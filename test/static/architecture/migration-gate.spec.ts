import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findMigrationOrderViolations, repoRoot } from './conformance';

function migrationDirNames(): string[] {
  const root = join(repoRoot(), 'prisma', 'migrations');
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
}

describe('migration gate', () => {
  it('has migrations 001–020 once, in directory order', () => {
    expect(findMigrationOrderViolations(migrationDirNames())).toEqual([]);
  });

  it('fails when migration 012 is ordered before 011', () => {
    const swapped = migrationDirNames().map((name) =>
      name.includes('_012_') ? '20250829120000_012_research_runs' : name,
    );
    expect(
      findMigrationOrderViolations(swapped).some((hit) => hit.startsWith('out of order')),
    ).toBe(true);
  });
});
