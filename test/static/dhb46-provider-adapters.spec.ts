import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');
const AI_ADAPTERS_ROOT = join(SRC_ROOT, 'ai', 'adapters');
const POLICY_ROOT = join(SRC_ROOT, 'ai', 'policy');

const SDK_IMPORT_RE =
  /from\s+['"](?:openai|voyageai|@anthropic-ai\/[^'"]+|@google\/[^'"]+)['"]/;
const PROVIDER_STRING_PATTERNS = [
  /\bgpt-/,
  /\bclaude-/,
  /\bgemini-/,
  /\btext-embedding/,
  /\bvoyage-/,
  /api\.openai\.com/,
  /api\.voyageai\.com/,
];
const RAW_HTTP_RE = /\b(?:fetch\s*\(|require\(\s*['"]axios['"]|from\s+['"]axios['"]|from\s+['"]undici['"])/;
const PROVIDER_HOST_RE = /api\.openai\.com|api\.voyageai\.com/;

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

function normalized(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, '/');
}

function isAllowedAdapterPath(path: string): boolean {
  return (
    path.startsWith('src/ai/adapters/') && !path.startsWith('src/ai/adapters/stub/')
  );
}

function isAllowedPolicyPath(path: string): boolean {
  return path.startsWith('src/ai/policy/');
}

function isLeakageGuard(path: string): boolean {
  return path === 'src/platform/errors/leakage-guard.ts';
}

describe('DHB-46 provider adapter static checks', () => {
  it('forbids provider SDK imports outside ai/adapters', () => {
    const violations: string[] = [];

    for (const file of collectFiles(SRC_ROOT)) {
      const path = normalized(file);
      if (isAllowedAdapterPath(path)) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      if (SDK_IMPORT_RE.test(content)) {
        violations.push(path);
      }
    }

    expect(violations).toEqual([]);
  });

  it('forbids provider/model/host strings outside adapters and policy', () => {
    const violations: string[] = [];

    for (const file of collectFiles(SRC_ROOT)) {
      const path = normalized(file);
      if (isAllowedAdapterPath(path) || isAllowedPolicyPath(path) || isLeakageGuard(path)) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      for (const pattern of PROVIDER_STRING_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${path}: ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('forbids raw HTTP calls to provider hosts outside adapters', () => {
    const violations: string[] = [];

    for (const file of collectFiles(SRC_ROOT)) {
      const path = normalized(file);
      if (isAllowedAdapterPath(path)) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      if (RAW_HTTP_RE.test(content) && PROVIDER_HOST_RE.test(content)) {
        violations.push(path);
      }
    }

    expect(violations).toEqual([]);
  });

  it('detects a planted SDK import outside adapters', () => {
    expect(SDK_IMPORT_RE.test("import OpenAI from 'openai';")).toBe(true);
    expect(isAllowedAdapterPath('src/platform/config/config.loader.ts')).toBe(false);
  });

  it('keeps live adapters under ai/adapters and policy review-gated', () => {
    expect(statSync(AI_ADAPTERS_ROOT).isDirectory()).toBe(true);
    expect(statSync(POLICY_ROOT).isDirectory()).toBe(true);
  });
});
