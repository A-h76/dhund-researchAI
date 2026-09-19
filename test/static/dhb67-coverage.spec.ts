import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const TEST = join(ROOT, 'test');

function collectTs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      files.push(...collectTs(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('DHB-67 GAP-COVERAGE-01 static contracts', () => {
  it('corpus must not reappear in src payloads, DTOs, or coverage code', () => {
    const violations: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      // Allow the explicit retirement guard string in the coverage port.
      if (file.replace(/\\/g, '/').endsWith('src/l0/ports/research-run-coverage.ts')) {
        continue;
      }
      if (/\bcorpus\b/.test(content)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] ?? '';
          if (
            /\bcorpus\b/.test(line) &&
            !line.trim().startsWith('*') &&
            !line.trim().startsWith('//')
          ) {
            violations.push(`${relative(ROOT, file)}:${i + 1}:${line.trim()}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('stepOutcomes aggregation lives in a dedicated module, not merged into coverage counters', () => {
    const outcomes = readFileSync(join(SRC, 'l0/ports/research-run-step-outcomes.ts'), 'utf8');
    const coverage = readFileSync(join(SRC, 'l0/ports/research-run-coverage.ts'), 'utf8');
    expect(outcomes).toMatch(/never live inside/);
    expect(coverage).toMatch(/stepOutcomes must not appear inside coverage/);
    expect(coverage).not.toMatch(/succeeded:\s*number/);
  });

  it('artifact generate path refuses empty rows on failure', () => {
    const service = readFileSync(
      join(SRC, 'orchestration/research-artifact-generate.service.ts'),
      'utf8',
    );
    expect(service).toMatch(/recordArtifactFailed/);
    expect(service).toMatch(/Persist only after successful AI execution/);
    expect(service).toMatch(/aiExecutionId/);
  });

  it('ResearchArtifact schema requires ai_execution_id', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(/model ResearchArtifact[\s\S]*aiExecutionId\s+String/);
    const migration = collectSql(
      join(ROOT, 'prisma/migrations/20260919120000_025_research_artifact_ai_execution'),
    );
    expect(migration).toMatch(/ai_execution_id/);
    expect(migration).toMatch(/SET NOT NULL/);
  });
});

function collectSql(path: string): string {
  const stats = readdirSync(path, { withFileTypes: true });
  let sql = '';
  for (const entry of stats) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      sql += collectSql(full);
    } else if (entry.name.endsWith('.sql')) {
      sql += readFileSync(full, 'utf8');
    }
  }
  return sql;
}

// Silence unused TEST in case we expand later — keep scan root documented.
void TEST;
