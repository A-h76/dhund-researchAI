import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueLivenessPolicy } from '../../src/platform/reliability/queue-liveness.config';
import { QUEUE_REGISTRY } from '../../src/platform/queues/queue-registry';
import { OCR_PRESIGN_TTL_SECONDS } from '../../src/ai/adapters/ocr/ocr-storage';

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

describe('DHB-51 OCR static checks', () => {
  const service = readFileSync(join(ROOT, 'src/ai/ocr/ocr.service.ts'), 'utf8');
  const processor = readFileSync(join(ROOT, 'src/apps/worker/ocr.processor.ts'), 'utf8');
  const extract = readFileSync(join(ROOT, 'src/ingestion/extract.service.ts'), 'utf8');
  const types = readFileSync(join(ROOT, 'src/ai/gateway/gateway.types.ts'), 'utf8');
  const ocrStorage = readFileSync(join(ROOT, 'src/ai/adapters/ocr/ocr-storage.ts'), 'utf8');
  const liveAdapters = readFileSync(join(ROOT, 'src/ai/adapters/live-adapters.ts'), 'utf8');

  it('keeps OCR behind the gateway and extract as the only router onto the ocr queue', () => {
    expect(extract).toContain("enqueue('ocr'");
    expect(service).toContain("capability: 'OCR'");
    expect(service).toContain('objectKey');
    expect(service).not.toContain('presignedGetUrl');
    expect(service).toContain("enqueue('chunk'");
    expect(processor).toContain("register('ocr')");
    expect(processor).not.toMatch(/adapter\.invoke/);
    expect(types).not.toMatch(/presignedGetUrl/);
    expect(types).not.toMatch(/presignedUrl/);

    const ocrEnqueues: string[] = [];
    const adapterInvokes: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      const relative = file.replace(/\\/g, '/');
      if (content.includes("enqueue('ocr'") && !relative.endsWith('/extract.service.ts')) {
        ocrEnqueues.push(relative);
      }
      if (relative.includes('/apps/worker/') && /adapter\.invoke/.test(content)) {
        adapterInvokes.push(relative);
      }
    }
    expect(ocrEnqueues).toEqual([]);
    expect(adapterInvokes).toEqual([]);
  });

  it('loads OCR storage only after the Gateway boundary, with a short-lived GET', () => {
    expect(ocrStorage).toContain('getPresignedGetUrl');
    expect(ocrStorage).toContain('getObjectBytes');
    expect(ocrStorage).toContain('OCR_PRESIGN_TTL_SECONDS');
    expect(liveAdapters).toContain('OcrCapabilityAdapter');
    expect(OCR_PRESIGN_TTL_SECONDS).toBe(120);
    expect(getQueueLivenessPolicy('ocr').timeoutMs).toBe(10 * 60 * 1000);
    expect(QUEUE_REGISTRY.ocr.attempts).toEqual({ kind: 'fixed', attempts: 3 });
    expect(service).not.toMatch(/markDocumentStatus\([^,]+,\s*'completed'/);
    expect(service).toContain("markDocumentStatus(version.documentId, 'failed'");
    expect(service).toContain("markDocumentStatus(version.documentId, partial ? 'partial'");
  });
});
