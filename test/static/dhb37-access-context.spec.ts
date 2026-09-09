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

describe('DHB-37 AccessContext static checks', () => {
  const authorize = readFileSync(
    join(ROOT, 'src/platform/authorization/authorize.ts'),
    'utf8',
  );
  const worker = readFileSync(
    join(ROOT, 'src/platform/authorization/worker-payload.ts'),
    'utf8',
  );
  const tokens = readFileSync(
    join(ROOT, 'src/iam/tokens/access-token.service.ts'),
    'utf8',
  );
  const l0 = readFileSync(join(ROOT, 'src/l0/l0.module.ts'), 'utf8');
  const cache = readFileSync(
    join(ROOT, 'src/l0/ports/access-context-cache.ts'),
    'utf8',
  );

  it('keeps decision helpers free of Redis and cache clients', () => {
    for (const source of [authorize, worker]) {
      expect(source).not.toContain('CACHE_SERVICE');
      expect(source).not.toContain('ioredis');
      expect(source).not.toContain("from 'ioredis'");
      expect(source).not.toContain('Redis');
    }
  });

  it('does not put role claims on access tokens', () => {
    expect(tokens).not.toContain('role');
    expect(tokens).not.toContain('orgId');
    expect(tokens).not.toContain('permission');
    expect(tokens).not.toContain('membership');
  });

  it('caches AccessContext under the platform namespace', () => {
    expect(cache).toContain("__platform__");
    expect(cache).toContain('ac:');
    expect(l0).toContain('RedisAccessContextInvalidator');
  });

  it('does not add @Public or a DHB-37 schema migration', () => {
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb37'))).toBe(
      false,
    );
    for (const file of collectFiles(join(SRC, 'iam'))) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toContain('@Public(');
    }
  });

  it('allows CanActivate only under src/iam/authorization', () => {
    const violations: string[] = [];
    for (const file of collectFiles(SRC)) {
      const normalized = file.replace(/\\/g, '/');
      if (normalized.includes('/iam/authorization/')) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      if (content.includes('CanActivate') || content.includes('UseGuards')) {
        violations.push(relative(process.cwd(), file));
      }
    }
    expect(violations).toEqual([]);
  });
});
