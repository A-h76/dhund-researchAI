import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

const VENDOR_PACKAGE_PREFIXES = [
  '@prisma/client',
  'prisma',
  'ioredis',
  'bullmq',
  '@aws-sdk/',
  'resend',
] as const;

function collectSourceFiles(dir: string): Array<{ path: string; content: string }> {
  const entries = readdirSync(dir);
  const files: Array<{ path: string; content: string }> = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!entry.endsWith('.ts')) {
      continue;
    }

    files.push({
      path: relative(process.cwd(), fullPath).replace(/\\/g, '/'),
      content: readFileSync(fullPath, 'utf8'),
    });
  }

  return files;
}

function isVendorPackage(importPath: string): boolean {
  return VENDOR_PACKAGE_PREFIXES.some(
    (prefix) => importPath === prefix || importPath.startsWith(prefix),
  );
}

function isAdapterFile(filePath: string): boolean {
  return /\/l0\/adapters\//.test(filePath.replace(/\\/g, '/'));
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

export interface VendorNeutralityViolation {
  file: string;
  importPath: string;
}

export function findVendorNeutralityViolations(
  files: Array<{ path: string; content: string }>,
): VendorNeutralityViolation[] {
  const violations: VendorNeutralityViolation[] = [];

  for (const file of files) {
    if (isAdapterFile(file.path)) {
      continue;
    }

    for (const importPath of extractImports(file.content)) {
      if (isVendorPackage(importPath)) {
        violations.push({ file: file.path, importPath });
      }
    }
  }

  return violations;
}

describe('vendor neutrality (static)', () => {
  it('has no vendor SDK imports outside l0/adapters', () => {
    const violations = findVendorNeutralityViolations(collectSourceFiles(SRC_ROOT));
    expect(violations).toEqual([]);
  });

  it('detects deliberate vendor import outside adapters', () => {
    const violations = findVendorNeutralityViolations([
      {
        path: 'src/platform/bad-vendor.example.ts',
        content: "import { PrismaClient } from '@prisma/client';",
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: 'src/platform/bad-vendor.example.ts',
      importPath: '@prisma/client',
    });
  });
});
