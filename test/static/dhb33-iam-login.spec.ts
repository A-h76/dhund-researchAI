import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const IAM_ROOT = join(ROOT, 'src', 'iam');

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

describe('DHB-33 IAM login static checks', () => {
  const controller = readFileSync(join(ROOT, 'src/iam/auth.controller.ts'), 'utf8');
  const tokens = readFileSync(
    join(ROOT, 'src/iam/tokens/access-token.service.ts'),
    'utf8',
  );
  const constants = readFileSync(
    join(ROOT, 'src/iam/tokens/access-token.constants.ts'),
    'utf8',
  );
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');

  it('exposes login, refresh, logout-all, and jwks under v1/auth without a global prefix', () => {
    const main = readFileSync(join(ROOT, 'src/main.ts'), 'utf8');
    expect(controller).toContain("@Controller('v1/auth')");
    expect(controller).toContain("@Post('login')");
    expect(controller).toContain("@Post('refresh')");
    expect(controller).toContain("@Post('logout-all')");
    expect(controller).toContain("@Get('jwks')");
    expect(main).not.toContain('setGlobalPrefix');
  });

  it('verifies access tokens with EdDSA only', () => {
    expect(constants).toContain("['EdDSA']");
    expect(tokens).toContain('algorithms: [...ACCESS_TOKEN_ALGORITHMS]');
    expect(tokens).not.toContain("'HS256'");
    expect(tokens).not.toContain("'none'");
    expect(tokens).not.toContain("'ES256'");
  });

  it('does not put role or membership claims on access tokens', () => {
    expect(tokens).not.toContain('role');
    expect(tokens).not.toContain('orgId');
    expect(tokens).not.toContain('permission');
    expect(tokens).not.toContain('email');
    expect(tokens).not.toContain('membership');
  });

  it('keeps Prisma, cookies, and generic guards out of src/iam', () => {
    const violations: string[] = [];
    for (const file of collectFiles(IAM_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (
        content.includes('@prisma/client') ||
        content.includes('PrismaClient') ||
        content.includes('CanActivate') ||
        content.includes('AuthGuard') ||
        content.includes('@Public(') ||
        content.includes('Set-Cookie') ||
        content.includes('dhund_refresh')
      ) {
        violations.push(relative(process.cwd(), file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not add refresh family expiry or a new migration in this slice', () => {
    const familyModel = schema.match(/model RefreshTokenFamily \{[\s\S]*?\n\}/)?.[0];
    expect(familyModel).toBeDefined();
    expect(familyModel).not.toContain('expiresAt');
    expect(familyModel).not.toContain('expires_at');
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb33'))).toBe(
      false,
    );
  });

  it('does not log token or password fields from IAM auth', () => {
    const authFiles = collectFiles(join(IAM_ROOT, 'auth')).concat(
      collectFiles(join(IAM_ROOT, 'tokens')),
    );
    for (const file of authFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/logger\.\w+\([\s\S]*password:/);
      expect(content).not.toMatch(/logger\.\w+\([\s\S]*refreshToken:/);
      expect(content).not.toMatch(/logger\.\w+\([\s\S]*accessToken:/);
      expect(content).not.toMatch(/logger\.\w+\([\s\S]*authorization:/);
    }
  });
});
