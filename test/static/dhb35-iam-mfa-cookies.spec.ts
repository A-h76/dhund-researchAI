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

describe('DHB-35 IAM MFA/cookies static checks', () => {
  const controller = readFileSync(join(ROOT, 'src/iam/auth.controller.ts'), 'utf8');
  const challenge = readFileSync(
    join(ROOT, 'src/iam/tokens/mfa-challenge.service.ts'),
    'utf8',
  );
  const access = readFileSync(
    join(ROOT, 'src/iam/tokens/access-token.service.ts'),
    'utf8',
  );
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
  const csrf = readFileSync(join(ROOT, 'src/platform/http/csrf.middleware.ts'), 'utf8');
  const cookies = readFileSync(join(ROOT, 'src/platform/http/auth-cookies.ts'), 'utf8');
  const recovery = readFileSync(join(ROOT, 'src/iam/mfa/recovery-code.ts'), 'utf8');

  it('exposes MFA routes under v1/auth', () => {
    expect(controller).toContain("@Controller('v1/auth')");
    expect(controller).toContain("@Post('mfa/totp/enrol')");
    expect(controller).toContain("@Post('mfa/totp/confirm')");
    expect(controller).toContain("@Post('mfa/totp/disable')");
    expect(controller).toContain("@Post('mfa/recovery/issue')");
    expect(controller).toContain("@Post('mfa/verify')");
  });

  it('keeps MFA challenges distinguishable from access JWTs', () => {
    expect(challenge).toContain('typ: MFA_CHALLENGE_TYP');
    expect(challenge).toContain('purpose: MFA_CHALLENGE_PURPOSE');
    expect(access).toContain("typ: 'JWT'");
    expect(access).not.toContain('dn-mfa+jwt');
    expect(access).not.toContain('mfa_pending');
  });

  it('does not add an MFA migration in this slice', () => {
    expect(schema).toContain('model TotpSecret');
    expect(schema).toContain('model MfaRecoveryCode');
    expect(schema).toContain('codeHash');
    expect(schema).not.toMatch(/model MfaRecoveryCode \{[\s\S]*plaintext/);
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb35'))).toBe(
      false,
    );
  });

  it('keeps Prisma, generic guards, and cookie names out of src/iam', () => {
    const violations: string[] = [];
    for (const file of collectFiles(IAM_ROOT)) {
      const content = readFileSync(file, 'utf8');
      const authorization = file.replace(/\\/g, '/').includes('/iam/authorization/');
      if (
        content.includes('@prisma/client') ||
        content.includes('PrismaClient') ||
        content.includes('Set-Cookie') ||
        content.includes('dhund_refresh') ||
        (!authorization &&
          (content.includes('CanActivate') || /\bAuthGuard\b/.test(content)))
      ) {
        violations.push(relative(process.cwd(), file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('places CSRF and cookies in platform HTTP', () => {
    expect(csrf).toContain('Bearer');
    expect(csrf).toContain('ErrorCode.CsrfInvalid');
    expect(cookies).toContain("REFRESH_COOKIE_NAME = 'dhund_refresh'");
    expect(cookies).toContain("CSRF_COOKIE_NAME = 'dhund_csrf'");
    expect(cookies).toContain('HttpOnly');
  });

  it('hashes recovery codes with SHA-256', () => {
    expect(recovery).toContain("createHash('sha256')");
  });
});
