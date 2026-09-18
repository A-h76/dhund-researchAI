import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueLivenessPolicy } from '../../src/platform/reliability/queue-liveness.config';
import { QUEUE_NAMES } from '../../src/platform/queues/queue-names';

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

describe('DHB-50 extract static checks', () => {
  const service = readFileSync(join(ROOT, 'src/ingestion/extract.service.ts'), 'utf8');
  const parser = readFileSync(
    join(ROOT, 'src/l0/adapters/pdfjs/pdfjs-parse.adapter.ts'),
    'utf8',
  );
  const processor = readFileSync(join(ROOT, 'src/apps/worker/extract.processor.ts'), 'utf8');
  const uploads = readFileSync(join(ROOT, 'src/ingestion/uploads.service.ts'), 'utf8');

  const requestExtract = readFileSync(
    join(ROOT, 'src/ingestion/request-extract.ts'),
    'utf8',
  );

  it('keeps extract as the sole PDF ingestion entry point', () => {
    const parsers: string[] = [];
    const evalUses: string[] = [];
    const extractEnqueues: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      const relative = file.replace(/\\/g, '/');
      if (content.includes('pdfjs-dist') && !relative.endsWith('/pdfjs-parse.adapter.ts')) {
        parsers.push(relative);
      }
      if (relative.includes('/ingestion/') && /eval\(|new Function|vm\.run/.test(content)) {
        evalUses.push(relative);
      }
      if (
        content.includes("enqueue('extract'") &&
        !relative.endsWith('/uploads.service.ts') &&
        !relative.endsWith('/request-extract.ts')
      ) {
        extractEnqueues.push(relative);
      }
    }
    expect(parsers).toEqual([]);
    expect(evalUses).toEqual([]);
    expect(extractEnqueues).toEqual([]);
    expect(parser).toContain('isEvalSupported: false');
    expect(uploads).toContain('requestExtractJob');
    expect(requestExtract).toContain("enqueue('extract'");
    expect(service).toContain("enqueue('chunk'");
    expect(service).toContain("enqueue('ocr'");
    expect(processor).toContain("register('extract')");
  });

  it('never marks extract success as completed and uses the 10 minute timeout', () => {
    expect(service).not.toMatch(/markDocumentStatus\([^,]+,\s*'completed'/);
    expect(service).toContain("markDocumentStatus(version.documentId, 'failed'");
    expect(getQueueLivenessPolicy('extract').timeoutMs).toBe(10 * 60 * 1000);
    expect(QUEUE_NAMES).toContain('extract');
    expect(parser).toContain('MIN_EXTRACTABLE_CHARS = 1');
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb50'))).toBe(false);
  });
});
