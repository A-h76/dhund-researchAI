import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

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

describe('DHB-50 single-owner ingestion pipeline', () => {
  it('has exactly one production enqueue of the extract queue', () => {
    const owners: string[] = [];
    for (const file of collectFiles(SRC_ROOT)) {
      const normalized = relative(process.cwd(), file).replace(/\\/g, '/');
      const content = readFileSync(file, 'utf8');
      if (/enqueue\(\s*['"]extract['"]/.test(content)) {
        owners.push(normalized);
      }
    }
    expect(owners).toEqual(['src/ingestion/extract/ingestion-pipeline.entry.ts']);
  });

  it('has exactly one PDF parser implementation', () => {
    const parsers: string[] = [];
    for (const file of collectFiles(SRC_ROOT)) {
      const normalized = relative(process.cwd(), file).replace(/\\/g, '/');
      const content = readFileSync(file, 'utf8');
      if (/from\s+['"]pdf-parse['"]/.test(content) || /\bpdfParse\s*\(/.test(content)) {
        parsers.push(normalized);
      }
    }
    expect(parsers).toEqual(['src/ingestion/extract/pdf-parse.adapter.ts']);
  });

  it('keeps extract queue timeout at 10 minutes (MEDIUM)', () => {
    const config = readFileSync(
      join(SRC_ROOT, 'platform', 'reliability', 'queue-liveness.config.ts'),
      'utf8',
    );
    expect(config).toMatch(/extract:\s*MEDIUM/);
    expect(config).toMatch(/const MEDIUM = \{ timeoutMs: 600_000/);
  });
});
