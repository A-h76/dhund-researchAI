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

describe('DHB-34 IAM verify/reset static checks', () => {
  const controller = readFileSync(join(ROOT, 'src/iam/auth.controller.ts'), 'utf8');
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const signer = readFileSync(
    join(ROOT, 'src/iam/tokens/auth-token.service.ts'),
    'utf8',
  );
  const access = readFileSync(
    join(ROOT, 'src/iam/tokens/access-token.service.ts'),
    'utf8',
  );

  it('exposes verify and reset routes under v1/auth', () => {
    expect(controller).toContain("@Controller('v1/auth')");
    expect(controller).toContain("@Post('verify-email')");
    expect(controller).toContain("@Post('verify-email/resend')");
    expect(controller).toContain("@Post('password/reset-request')");
    expect(controller).toContain("@Post('password/reset')");
  });

  it('signs auth tokens as EdDSA with a distinct typ', () => {
    expect(signer).toContain("typ: AUTH_TOKEN_TYP");
    expect(signer).toContain("algorithms: [...AUTH_TOKEN_ALGORITHMS]");
    expect(access).toContain("typ: 'JWT'");
    expect(access).not.toContain('dn-at+jwt');
  });

  it('does not add an auth-token migration or TOTP columns in this slice', () => {
    const tokenModel = schema.match(/model AuthToken \{[\s\S]*?\n\}/)?.[0];
    expect(tokenModel).toBeDefined();
    expect(tokenModel).toContain('tokenHash');
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb34'))).toBe(
      false,
    );
  });

  it('keeps Prisma and the Resend SDK out of src/iam', () => {
    const violations: string[] = [];
    for (const file of collectFiles(IAM_ROOT)) {
      const content = readFileSync(file, 'utf8');
      const authorization = file.replace(/\\/g, '/').includes('/iam/authorization/');
      if (
        content.includes('@prisma/client') ||
        content.includes('PrismaClient') ||
        content.includes("from 'resend'") ||
        (!authorization &&
          (content.includes('CanActivate') || /\bAuthGuard\b/.test(content)))
      ) {
        violations.push(relative(process.cwd(), file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not log token or hash fields from IAM auth/token code', () => {
    const authFiles = collectFiles(join(IAM_ROOT, 'auth')).concat(
      collectFiles(join(IAM_ROOT, 'tokens')),
    );
    for (const file of authFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/logger\.\w+\(\{[^}]*\bpassword\s*:/);
      expect(content).not.toMatch(/logger\.\w+\(\{[^}]*\btoken\s*:/);
      expect(content).not.toMatch(/logger\.\w+\(\{[^}]*tokenHash\s*:/);
      expect(content).not.toMatch(/logger\.\w+\(\{[^}]*\bhtml\s*:/);
    }
  });
});
