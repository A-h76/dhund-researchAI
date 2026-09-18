import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ANN_NEAREST_SQL } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import { FTS_SEARCH_SQL } from '../../src/l0/adapters/prisma/prisma-retrieval-index.adapter';
import { RETRIEVAL_ELIGIBILITY_SQL } from '../../src/l0/ports/retrieval-eligibility';
import { EMBED_DOCUMENT_INPUT_TYPE, EMBED_QUERY_INPUT_TYPE } from '../../src/ai/policy/embed-policy.constants';

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

describe('DHB-55 retrieval single-owner and GAP-EMBED-01', () => {
  it('has exactly one IRetrievalService implementation', () => {
    const implementors: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      if (/class\s+\w+\s+implements\s+IRetrievalService/.test(content)) {
        implementors.push(file.replace(/\\/g, '/').slice(file.replace(/\\/g, '/').indexOf('/src/') + 1));
      }
    }
    expect(implementors).toEqual(['src/retrieval/retrieval.service.ts']);
    expect(read('src/retrieval/retrieval.service.ts')).toContain('export class RetrievalService implements IRetrievalService');
  });

  it('keeps provider SDKs out of the retrieval module', () => {
    for (const file of collectTs(join(SRC, 'retrieval'))) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/voyageai|VoyageAIClient|openai|OpenAI\b/);
      expect(content).not.toMatch(/from ['"].*\/ai\//);
      expect(content).not.toMatch(/capability:\s*'EMBED'/);
      expect(content).not.toMatch(/elasticsearch|opensearch|pinecone|weaviate|milvus|qdrant/i);
    }
  });

  it('GAP-EMBED-01: query embed uses input_type=query; stored chunks stay document', () => {
    expect(EMBED_QUERY_INPUT_TYPE).toBe('query');
    expect(EMBED_DOCUMENT_INPUT_TYPE).toBe('document');
    const queryEmbed = read('src/ai/embed/query-embed.adapter.ts');
    const embedService = read('src/ai/embed/embed.service.ts');
    expect(queryEmbed).toContain('EMBED_QUERY_INPUT_TYPE');
    expect(queryEmbed).not.toContain('EMBED_DOCUMENT_INPUT_TYPE');
    expect(embedService).toContain('EMBED_DOCUMENT_INPUT_TYPE');
    expect(embedService).not.toMatch(/inputType:\s*'query'/);
    expect(queryEmbed).toContain("capability: 'EMBED'");
    expect(queryEmbed).toContain('GATEWAY_SERVICE');
  });

  it('places project_id before <=> and @@ and join-evaluates eligibility in both arms', () => {
    expect(ANN_NEAREST_SQL.indexOf('project_id')).toBeGreaterThanOrEqual(0);
    expect(ANN_NEAREST_SQL.indexOf('<=>')).toBeGreaterThan(ANN_NEAREST_SQL.indexOf('project_id'));
    expect(FTS_SEARCH_SQL.indexOf('project_id')).toBeGreaterThanOrEqual(0);
    expect(FTS_SEARCH_SQL.indexOf('@@')).toBeGreaterThan(FTS_SEARCH_SQL.indexOf('project_id'));
    expect(ANN_NEAREST_SQL).toContain(RETRIEVAL_ELIGIBILITY_SQL);
    expect(FTS_SEARCH_SQL).toContain(RETRIEVAL_ELIGIBILITY_SQL);
    expect(RETRIEVAL_ELIGIBILITY_SQL).toContain('d.deleted_at IS NULL');
    expect(RETRIEVAL_ELIGIBILITY_SQL).toContain('dv.retired_at IS NULL');
    expect(RETRIEVAL_ELIGIBILITY_SQL).toContain("d.status = 'completed'");
    expect(RETRIEVAL_ELIGIBILITY_SQL).toContain("ce.status = 'ok'");
    expect(RETRIEVAL_ELIGIBILITY_SQL).toContain('ce.model_version');
    expect(RETRIEVAL_ELIGIBILITY_SQL).toContain("rs.capabilities->>'body'");
    expect(ANN_NEAREST_SQL).not.toMatch(/CREATE\s+INDEX/i);
    expect(FTS_SEARCH_SQL).not.toMatch(/CREATE\s+INDEX/i);
  });
});
