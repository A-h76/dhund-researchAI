import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function listExpectedMigrationNames(migrationsRoot: string): string[] {
  try {
    return readdirSync(migrationsRoot)
      .filter((entry) => {
        const fullPath = join(migrationsRoot, entry);
        return statSync(fullPath).isDirectory();
      })
      .sort();
  } catch {
    return [];
  }
}

export interface AppliedMigrationRecord {
  readonly migrationName: string;
  readonly finishedAt: Date | null;
  readonly rolledBackAt: Date | null;
}

export function evaluateMigrationReadiness(
  expectedMigrationNames: readonly string[],
  appliedMigrations: readonly AppliedMigrationRecord[],
): boolean {
  if (expectedMigrationNames.length === 0) {
    return false;
  }

  const appliedByName = new Map(
    appliedMigrations.map((record) => [record.migrationName, record]),
  );

  for (const expectedName of expectedMigrationNames) {
    const record = appliedByName.get(expectedName);
    if (record === undefined || record.finishedAt === null) {
      return false;
    }
    if (record.rolledBackAt !== null) {
      return false;
    }
  }

  const hasIncomplete = appliedMigrations.some(
    (record) => record.finishedAt === null,
  );
  if (hasIncomplete) {
    return false;
  }

  return true;
}
