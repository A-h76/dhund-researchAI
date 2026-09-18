import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EMBED_MODEL_ID, EMBED_MODEL_VERSION } from '../../src/ai/policy/embed-policy.constants';
import { ANN_NEAREST_SQL } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import { FTS_SEARCH_SQL } from '../../src/l0/adapters/prisma/prisma-retrieval-index.adapter';
import {
  RETRIEVAL_EMBED_MODEL_ID,
  RETRIEVAL_EMBED_MODEL_VERSION,
} from '../../src/retrieval/embed-identity';

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

describe('DHB-57 retrieval search contracts', () => {
  it('keeps embed identity aligned with AI policy without importing ai/', () => {
    expect(RETRIEVAL_EMBED_MODEL_ID).toBe(EMBED_MODEL_ID);
    expect(RETRIEVAL_EMBED_MODEL_VERSION).toBe(EMBED_MODEL_VERSION);
    for (const file of collectTs(join(SRC, 'retrieval'))) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/from ['"].*\/ai\//);
    }
  });

  it('does not let retrieval mint Claim, Citation, or WritingSentenceBinding rows', () => {
    for (const file of collectTs(join(SRC, 'retrieval'))) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/claim\.create|citation\.create|writingSentenceBinding/i);
      expect(content).not.toMatch(/EvidenceClaimLink/);
    }
  });

  it('threads stage scores through ANN and FTS SQL', () => {
    expect(ANN_NEAREST_SQL).toContain('AS "vectorScore"');
    expect(FTS_SEARCH_SQL).toContain('AS "ftsScore"');
  });

  it('registers search only on the API app and requires VIEWER', () => {
    expect(read('src/apps/api/api-app.module.ts')).toContain('RetrievalApiModule');
    expect(read('src/apps/worker/worker-app.module.ts')).not.toContain('RetrievalApiModule');
    expect(read('src/apps/worker/worker-app.module.ts')).not.toContain('RetrievalSearchController');
    const controller = read('src/retrieval/retrieval-search.controller.ts');
    expect(controller).toContain("v1/projects/:projectId/retrieval/search");
    expect(controller).toContain("@RequireProjectRole('VIEWER')");
  });

  it('persists a RetrievalTrace on every retrieve path including both-arms-down', () => {
    const service = read('src/retrieval/retrieval.service.ts');
    expect(service).toContain('persistTrace');
    expect(service).toContain('ErrorCode.RetrievalUnavailable');
    expect(service).toContain("fallbacksUsed.push('vector')");
    expect(service).toContain("fallbacksUsed.push('fts')");
    expect(service).toContain("fallbacksUsed.push('rerank')");
  });

  it('stores the retrieval fingerprint in Postgres rather than a second database', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).toContain('model RetrievalTrace');
    expect(schema).toContain('queryFingerprint');
    expect(schema).toContain('@@map("retrieval_traces")');
    const sql = read('prisma/migrations/20250829132100_021_retrieval_traces/migration.sql');
    expect(sql).toContain('query_fingerprint');
    expect(sql).toContain('idx_retrieval_traces_project_fingerprint');
  });
});
