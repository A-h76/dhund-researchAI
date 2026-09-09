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

describe('DHB-32 IAM registration static checks', () => {
  it('wires IamModule into ApiAppModule without a global /v1 prefix', () => {
    const api = readFileSync(join(ROOT, 'src/apps/api/api-app.module.ts'), 'utf8');
    const main = readFileSync(join(ROOT, 'src/main.ts'), 'utf8');
    const controller = readFileSync(
      join(ROOT, 'src/iam/auth.controller.ts'),
      'utf8',
    );

    expect(api).toContain('IamModule');
    expect(controller).toContain("@Controller('v1/auth')");
    expect(controller).toContain("@Post('register')");
    expect(main).not.toContain('setGlobalPrefix');
  });

  it('keeps Prisma and HIBP hosts out of src/iam', () => {
    const violations: string[] = [];
    for (const file of collectFiles(IAM_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (
        content.includes('@prisma/client') ||
        content.includes('PrismaClient') ||
        content.includes('pwnedpasswords')
      ) {
        violations.push(relative(process.cwd(), file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not send email via the Resend SDK from IAM', () => {
    for (const file of collectFiles(IAM_ROOT)) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toContain("from 'resend'");
      expect(content).not.toContain("from \"resend\"");
    }
  });

  it('does not implement MFA in this slice', () => {
    const controller = readFileSync(
      join(ROOT, 'src/iam/auth.controller.ts'),
      'utf8',
    );
    expect(controller).not.toContain('totp');
    expect(controller).not.toContain('mfa');
  });
});
