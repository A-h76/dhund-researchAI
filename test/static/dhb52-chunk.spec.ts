import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueLivenessPolicy } from '../../src/platform/reliability/queue-liveness.config';
import { QUEUE_NAMES } from '../../src/platform/queues/queue-names';
import { QUEUE_REGISTRY } from '../../src/platform/queues/queue-registry';

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

describe('DHB-52 chunk static checks', () => {
  const chunkService = readFileSync(join(ROOT, 'src/ingestion/chunk.service.ts'), 'utf8');
  const chunkBlocks = readFileSync(join(ROOT, 'src/ingestion/chunk.blocks.ts'), 'utf8');
  const chunkAdapter = readFileSync(
    join(ROOT, 'src/l0/adapters/prisma/prisma-chunk-store.adapter.ts'),
    'utf8',
  );
  const processor = readFileSync(join(ROOT, 'src/apps/worker/chunk.processor.ts'), 'utf8');

  it('chunk reads blocks only — it never re-parses the PDF or touches storage (§20.2 I-2)', () => {
    for (const source of [chunkService, chunkBlocks, processor]) {
      expect(source).not.toContain('pdfjs');
      expect(source).not.toContain('PDF_PARSE_SERVICE');
      expect(source).not.toContain('OBJECT_STORAGE_SERVICE');
      expect(source).not.toContain('getObjectBytes');
      expect(source).not.toContain('getPresigned');
    }
    expect(chunkService).toContain('listBlocks');

    // Single-owner: pdfjs stays in the one parser adapter.
    const parsers: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      const relative = file.replace(/\\/g, '/');
      if (content.includes('pdfjs-dist') && !relative.endsWith('/pdfjs-parse.adapter.ts')) {
        parsers.push(relative);
      }
    }
    expect(parsers).toEqual([]);
  });

  it('only extract and ocr enqueue chunk; only the chunk service enqueues embed', () => {
    const chunkEnqueuers: string[] = [];
    const embedEnqueuers: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      const relative = file.replace(/\\/g, '/');
      if (content.includes("enqueue('chunk'")) {
        chunkEnqueuers.push(relative);
      }
      if (content.includes("enqueue('embed'")) {
        embedEnqueuers.push(relative);
      }
    }
    expect(chunkEnqueuers).toHaveLength(2);
    expect(chunkEnqueuers.some((path) => path.endsWith('/ingestion/extract.service.ts'))).toBe(true);
    expect(chunkEnqueuers.some((path) => path.endsWith('/ai/ocr/ocr.service.ts'))).toBe(true);
    expect(embedEnqueuers).toHaveLength(1);
    expect(embedEnqueuers[0]).toContain('/ingestion/chunk.service.ts');
  });

  it('chunks.text is written once and never mutated (lexical projection invariant)', () => {
    // The adapter creates chunk rows and offers no update path.
    expect(chunkAdapter).toContain('createMany');
    expect(chunkAdapter).not.toMatch(/chunk\.update\(/);
    expect(chunkAdapter).not.toMatch(/chunk\.updateMany\(/);
    expect(chunkAdapter).not.toMatch(/chunk\.upsert\(/);

    // No other src file writes chunk rows.
    for (const file of collectTs(SRC)) {
      const relative = file.replace(/\\/g, '/');
      if (relative.endsWith('/prisma-chunk-store.adapter.ts')) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/chunk\.createMany|chunk\.update\(|chunk\.upsert\(/);
    }

    // The contentHash covers the derived chunk text.
    expect(chunkBlocks).toMatch(/createHash\('sha256'\)\.update\(text/);
  });

  it('chunk is the sole owner of document completion; extract and ocr never complete', () => {
    const completers: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      const relative = file.replace(/\\/g, '/');
      if (/markDocumentStatus\([^,]+,\s*'completed'/.test(content)) {
        completers.push(relative);
      }
      if (/toStatus:\s*[^,\n]*'completed'/.test(content)) {
        completers.push(relative);
      }
    }
    expect(completers).toEqual([expect.stringContaining('/ingestion/chunk.service.ts')]);
  });

  it('keeps the locked queue topology: 25 queues, chunk retries 5x with DLQ and long timeout', () => {
    expect(QUEUE_NAMES).toHaveLength(25);
    expect(QUEUE_NAMES).toContain('chunk');
    expect(QUEUE_REGISTRY.chunk.attempts).toEqual({ kind: 'fixed', attempts: 5 });
    expect(QUEUE_REGISTRY.chunk.dlqName).toBe('chunk-dlq');
    expect(getQueueLivenessPolicy('chunk').timeoutMs).toBe(60 * 60 * 1000);
    expect(processor).toContain("register('chunk')");
  });

  it('introduces no schema migration (chunks.text comes from DHB-31 migration 016)', () => {
    const migrations = readdirSync(join(ROOT, 'prisma/migrations'));
    expect(migrations.some((name) => name.toLowerCase().includes('dhb52'))).toBe(false);
    const fts = readFileSync(
      join(ROOT, 'prisma/migrations/20250829131200_016_fts/migration.sql'),
      'utf8',
    );
    expect(fts).toContain('ADD COLUMN "text"');
    expect(fts).toContain('search_vector');
  });
});
