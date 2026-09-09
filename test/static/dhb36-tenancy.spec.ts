import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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

describe('DHB-36 tenancy static checks (GAP-CAT-A-01 / P-a)', () => {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const orgs = readFileSync(join(ROOT, 'src/projects/orgs.controller.ts'), 'utf8');
  const projects = readFileSync(
    join(ROOT, 'src/projects/projects.controller.ts'),
    'utf8',
  );
  const memberships = readFileSync(
    join(ROOT, 'src/projects/memberships.controller.ts'),
    'utf8',
  );
  const service = readFileSync(
    join(ROOT, 'src/projects/tenancy.service.ts'),
    'utf8',
  );
  const api = readFileSync(join(ROOT, 'src/apps/api/api-app.module.ts'), 'utf8');
  const main = readFileSync(join(ROOT, 'src/main.ts'), 'utf8');
  const health = readFileSync(
    join(ROOT, 'src/apps/api/health.controller.ts'),
    'utf8',
  );
  const catalog = readFileSync(
    join(ROOT, 'src/platform/events/catalog/definitions.ts'),
    'utf8',
  );
  const invalidator = readFileSync(
    join(ROOT, 'src/l0/adapters/noop/noop-access-context-invalidator.ts'),
    'utf8',
  );

  it('keeps the four project roles and org BILLING off the data ladder', () => {
    const projectEnum = schema.match(/enum ProjectRole \{[\s\S]*?\n\}/)?.[0];
    expect(projectEnum).toContain('OWNER');
    expect(projectEnum).toContain('ADMIN');
    expect(projectEnum).toContain('EDITOR');
    expect(projectEnum).toContain('VIEWER');
    expect(projectEnum?.match(/\b[A-Z]+\b/g)).toEqual([
      'OWNER',
      'ADMIN',
      'EDITOR',
      'VIEWER',
    ]);
  });

  it('exposes org, project, and membership routes without a global prefix', () => {
    expect(orgs).toContain("@Controller('v1/orgs')");
    expect(orgs).toContain("@Get(':orgId')");
    expect(orgs).toContain("@Patch(':orgId')");
    expect(orgs).toContain("@Post(':orgId/projects')");
    expect(projects).toContain("@Controller('v1/projects')");
    expect(memberships).toContain(
      "@Controller('v1/projects/:projectId/memberships')",
    );
    expect(memberships).toContain('@Post()');
    expect(memberships).toContain("@Delete(':membershipId')");
    expect(api).toContain('ProjectsModule');
    expect(main).not.toContain('setGlobalPrefix');
    expect(health).toContain("@Get('health')");
    expect(health).toContain("@Get('ready')");
  });

  it('marks org and project routes with role metadata and no Nest guards', () => {
    expect(orgs).toContain("@RequireOrgRole('MEMBER')");
    expect(orgs).toContain("@RequireOrgRole('ADMIN')");
    expect(projects).toContain("@RequireProjectRole('VIEWER')");
    expect(projects).toContain("@RequireProjectRole('EDITOR')");
    expect(projects).toContain("@RequireProjectRole('OWNER')");
    expect(memberships).toContain("@RequireProjectRole('ADMIN')");
    const sources = [orgs, projects, memberships, service];
    for (const source of sources) {
      expect(source).not.toContain('CanActivate');
      expect(source).not.toContain('AuthGuard');
      expect(source).not.toContain('UseGuards');
    }
  });

  it('keeps Prisma, Redis AccessContext, and body projectId out of IAM/projects', () => {
    const roots = [
      join(SRC, 'iam'),
      join(SRC, 'projects'),
    ];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of collectFiles(root)) {
        const content = readFileSync(file, 'utf8');
        if (
          content.includes('@prisma/client') ||
          content.includes('PrismaClient') ||
          content.includes('CACHE_SERVICE') ||
          content.includes('ioredis') ||
          content.includes('CanActivate') ||
          content.includes('AuthGuard') ||
          content.includes('UseGuards')
        ) {
          violations.push(relative(process.cwd(), file));
        }
      }
    }
    expect(violations).toEqual([]);
    expect(orgs).not.toContain('body.projectId');
    expect(projects).not.toContain('body.projectId');
    expect(memberships).not.toContain('body.projectId');
    expect(service).not.toContain('getPrismaClient');
  });

  it('does not add a schema migration and uses the no-op invalidation seam', () => {
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb36'))).toBe(
      false,
    );
    expect(service).toContain('invalidateAccessContext');
    expect(invalidator).toContain('invalidateAccessContext');
    expect(invalidator).not.toContain('CACHE_SERVICE');
    expect(catalog).toContain("eventType: 'projects.break_glass.used'");
    expect(service).toContain('projects.project.created');
    expect(service).toContain('projects.membership.added');
    expect(service).toContain('projects.membership.removed');
  });
});
