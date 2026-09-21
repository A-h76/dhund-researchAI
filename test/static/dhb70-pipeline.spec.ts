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

describe('DHB-70 static contracts — single ingestion pipeline (R9)', () => {
  it('discovery admission uses requestExtractJob, not a second extract enqueue', () => {
    const admission = readFileSync(
      join(SRC, 'connectors/discovery-admission.service.ts'),
      'utf8',
    );
    expect(admission).toContain('requestExtractJob');
    expect(admission).not.toMatch(/enqueue\('extract'/);
    expect(admission).not.toMatch(/enqueue\("extract"/);
  });

  it('connector and discovery modules never enqueue extract/ocr/chunk/embed directly', () => {
    const files = collectTs(join(SRC, 'connectors'));
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (
        /enqueue\('extract'|enqueue\('ocr'|enqueue\('chunk'|enqueue\('embed'/.test(content)
      ) {
        violations.push(file.replace(/\\/g, '/'));
      }
    }
    expect(violations).toEqual([]);
  });

  it('uploads also enter extract only via requestExtractJob', () => {
    const uploads = readFileSync(join(SRC, 'ingestion/uploads.service.ts'), 'utf8');
    expect(uploads).toContain('requestExtractJob');
    expect(uploads).not.toMatch(/enqueue\('extract'/);

    const requestExtract = readFileSync(join(SRC, 'ingestion/request-extract.ts'), 'utf8');
    expect(requestExtract).toContain("enqueue('extract'");
  });

  it('GAP-CONN-CACHE-01: connector cache adapter targets Postgres connector_cache', () => {
    const adapter = readFileSync(
      join(SRC, 'l0/adapters/prisma/prisma-connector-cache.adapter.ts'),
      'utf8',
    );
    expect(adapter).toContain('connectorCache');
    expect(adapter).not.toMatch(/\bCACHE_SERVICE\b|\bRedisCache\b|ioredis|from ['"]redis['"]/);

    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).toContain('model ConnectorCache');
    expect(schema).toContain('@@map("connector_cache")');
    expect(schema).toContain('@@unique([provider, cacheKey]');
  });
});
