import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('DHB-56 fusion order and GAP-INTERACTIVE-STREAM-01', () => {
  it('keeps arms → fusion → rerank → authz → shortfall → top-k', () => {
    const source = read('src/retrieval/retrieval.service.ts');
    const retrieveBody = source.slice(
      source.indexOf('async retrieve'),
      source.indexOf('private async rerankFused'),
    );
    const fusion = retrieveBody.indexOf('ineligibleCountAtFusionBoundary');
    const rrf = retrieveBody.indexOf('fuseRrf(');
    const rerank = retrieveBody.indexOf('rerankFused');
    const authz = retrieveBody.indexOf('authzRecheck');
    const shortfall = retrieveBody.indexOf('recordFilteredRecall');
    const topK = retrieveBody.indexOf('surviving.slice(0, input.k)');
    expect(fusion).toBeGreaterThanOrEqual(0);
    expect(rrf).toBeGreaterThan(fusion);
    expect(rerank).toBeGreaterThan(rrf);
    expect(authz).toBeGreaterThan(rerank);
    expect(shortfall).toBeGreaterThan(authz);
    expect(topK).toBeGreaterThan(shortfall);
    expect(retrieveBody.slice(rrf)).not.toMatch(/armLimit/);
  });

  it('does not relocate eligibility into fusion, rerank, or authz', () => {
    for (const file of [
      'src/retrieval/rrf.ts',
      'src/retrieval/authz-recheck.ts',
      'src/retrieval/bm25.ts',
      'src/retrieval/rerank.port.ts',
    ]) {
      const content = read(file);
      expect(content).not.toMatch(/deleted_at|retired_at|rights_snapshot|status = 'completed'/);
      expect(content).not.toMatch(/CREATE\s+INDEX/i);
    }
    expect(read('src/retrieval/over-fetch.ts')).toContain('RETRIEVAL_OVER_FETCH_FACTOR');
  });

  it('GAP-INTERACTIVE-STREAM-01: interactive rerank enqueues nothing', () => {
    expect(QUEUE_NAMES as readonly string[]).not.toContain('rerank');
    expect(QUEUE_NAMES as readonly string[]).not.toContain('chat');
    expect(QUEUE_NAMES as readonly string[]).not.toContain('autocomplete');
    const adapter = read('src/ai/rerank/rerank.adapter.ts');
    expect(adapter).toContain("capability: 'RERANK'");
    expect(adapter).toContain('GATEWAY_SERVICE');
    expect(adapter).not.toMatch(/QUEUE_SERVICE|addJob|enqueue\(/);
    for (const file of collectTs(join(SRC, 'retrieval'))) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/QUEUE_SERVICE|addJob|from ['"].*\/ai\//);
      expect(content).not.toMatch(/capability:\s*'RERANK'/);
      expect(content).not.toMatch(/voyageai|openai|OpenAI\b/);
    }
  });
});
