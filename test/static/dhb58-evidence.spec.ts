import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const EVIDENCE_SRC = join(ROOT, 'src', 'evidence');
const MIGRATIONS = join(ROOT, 'prisma', 'migrations');

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

describe('DHB-58 evidence grounding static checks', () => {
  const evidenceFiles = collectFiles(EVIDENCE_SRC).map((file) => ({
    path: relative(ROOT, file).replace(/\\/g, '/'),
    content: readFileSync(file, 'utf8'),
  }));

  it('does not import ai/ or assemble system instructions from evidence text', () => {
    const violations: string[] = [];
    for (const file of evidenceFiles) {
      if (
        /from\s+['"][^'"]*\/ai\//.test(file.content) ||
        /from\s+['"]@ai\//.test(file.content)
      ) {
        violations.push(`${file.path}: ai import`);
      }
      if (
        /role:\s*['"]system['"]/.test(file.content) ||
        /systemPrompt/.test(file.content)
      ) {
        violations.push(`${file.path}: system prompt assembly`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('marks external-source text as untrusted content', () => {
    const untrusted = evidenceFiles.find((file) =>
      file.path.endsWith('src/evidence/untrusted-content.ts'),
    );
    expect(untrusted).toBeDefined();
    expect(untrusted?.content).toContain('UNTRUSTED_EXTERNAL_CONTENT');
    expect(untrusted?.content).toContain('never place it in system instructions');
  });

  it('enforces a non-empty locator object at the database layer', () => {
    const dirs = readdirSync(MIGRATIONS).filter((name) =>
      statSync(join(MIGRATIONS, name)).isDirectory(),
    );
    const locatorMigration = dirs.find((name) => name.includes('_022_'));
    expect(locatorMigration).toBeDefined();
    const sql = readFileSync(join(MIGRATIONS, locatorMigration!, 'migration.sql'), 'utf8');
    expect(sql).toContain('chk_evidence_locator_object');
    expect(sql).toContain("jsonb_typeof(\"locator\") = 'object'");
    expect(sql).toContain("'{}'::jsonb");
  });

  it('keeps provenance FKs RESTRICT in the evidence spine', () => {
    const sql = readFileSync(
      join(MIGRATIONS, '20250829131100_011_evidence_spine', 'migration.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /evidence_ai_execution_id_fkey[\s\S]*ON DELETE RESTRICT/,
    );
    expect(sql).toContain('chk_evidence_body_grounded_chunk');
    expect(sql).toContain('chk_evidence_llm_provenance');
    expect(sql).toContain('chk_sources_exactly_one');
  });
});
