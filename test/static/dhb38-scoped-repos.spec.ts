import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ANN_NEAREST_SQL } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('DHB-38 scoped repository static checks', () => {
  const cursor = readFileSync(
    join(ROOT, 'src/platform/persistence/cursor.ts'),
    'utf8',
  );
  const documentsController = readFileSync(
    join(ROOT, 'src/ingestion/documents.controller.ts'),
    'utf8',
  );
  const documentsService = readFileSync(
    join(ROOT, 'src/ingestion/documents.service.ts'),
    'utf8',
  );
  const adapter = readFileSync(
    join(ROOT, 'src/l0/adapters/prisma/prisma-scoped-store.adapter.ts'),
    'utf8',
  );
  const api = readFileSync(
    join(ROOT, 'src/apps/api/api-app.module.ts'),
    'utf8',
  );

  it('GAP-CURSOR-01: cursors are opaque unsigned Base64URL payloads', () => {
    expect(cursor).toContain("toString('base64url')");
    expect(cursor).toContain('CURSOR_VERSION');
    expect(cursor).toContain("CURSOR_SORT = 'id'");
    expect(cursor).not.toContain('createHmac');
    expect(cursor).not.toContain('SignJWT');
    expect(cursor).not.toContain('jose');
  });

  it('keeps Prisma out of ingestion, evidence, and orchestration', () => {
    const roots = [
      join(SRC, 'ingestion'),
      join(SRC, 'evidence'),
      join(SRC, 'orchestration'),
    ];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectFiles(root)) {
        const content = readFileSync(file, 'utf8');
        if (
          content.includes('@prisma/client') ||
          content.includes('PrismaClient') ||
          content.includes('getPrismaClient')
        ) {
          violations.push(relative(process.cwd(), file).replace(/\\/g, '/'));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('guards document routes and never reads body.projectId', () => {
    expect(documentsController).toContain("@RequireProjectRole('VIEWER')");
    expect(documentsController).toContain("@RequireProjectRole('EDITOR')");
    expect(documentsController).toContain(
      "@Controller('v1/projects/:projectId/documents')",
    );
    expect(documentsController).not.toContain('body.projectId');
    expect(documentsService).not.toContain('body.projectId');
    expect(documentsService).toContain('projectScopeFrom');
    expect(api).toContain('IngestionModule');
  });

  it('places project_id in WHERE before the ANN distance operator', () => {
    const projectIdAt = ANN_NEAREST_SQL.indexOf('project_id');
    const distanceAt = ANN_NEAREST_SQL.indexOf('<=>');
    expect(projectIdAt).toBeGreaterThanOrEqual(0);
    expect(distanceAt).toBeGreaterThan(projectIdAt);
    expect(adapter).toContain('ANN_NEAREST_SQL');
    expect(adapter).toContain('$queryRawUnsafe');
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb38'))).toBe(
      false,
    );
  });
});
