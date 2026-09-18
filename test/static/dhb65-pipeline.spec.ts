import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function collectTs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTs(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('DHB-65 static contracts', () => {
  it('GAP-PRESET-01: schema assertion confirms no research_run_presets table', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/model\s+ResearchRunPreset[sA-Z]/);
    expect(schema).not.toMatch(/@@map\("research_run_presets"\)/);
    expect(schema).toContain('customDag');
    expect(schema).toContain('@map("custom_dag")');

    const migrations = join(ROOT, 'prisma/migrations');
    for (const name of readdirSync(migrations, { withFileTypes: true })) {
      if (!name.isDirectory()) {
        continue;
      }
      const sql = collectSql(join(migrations, name.name));
      expect(sql).not.toMatch(/CREATE TABLE\s+"?research_run_presets"?/i);
    }
  });

  it('R9: the run does not create a second ingestion pipeline', () => {
    const orchestrationFiles = collectTs(join(SRC, 'orchestration'));
    const violations: string[] = [];
    for (const file of orchestrationFiles) {
      const content = readFileSync(file, 'utf8');
      if (
        /enqueue\('extract'|enqueue\('ocr'|enqueue\('chunk'|enqueue\('embed'/.test(content)
      ) {
        violations.push(file.replace(/\\/g, '/'));
      }
    }
    expect(violations).toEqual([]);

    const workerStep = readFileSync(
      join(SRC, 'apps/worker/research-run-step.executor.ts'),
      'utf8',
    );
    expect(workerStep).toContain('requestExtractJob');
    expect(workerStep).not.toMatch(/enqueue\('extract'/);
    expect(workerStep).not.toMatch(/enqueue\('ocr'/);
    expect(workerStep).not.toMatch(/enqueue\('chunk'/);
    expect(workerStep).not.toMatch(/enqueue\('embed'/);

    const requestExtract = readFileSync(join(SRC, 'ingestion/request-extract.ts'), 'utf8');
    expect(requestExtract).toContain("enqueue('extract'");
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
