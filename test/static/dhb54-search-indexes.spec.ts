import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ANN_NEAREST_SQL } from '../../src/l0/adapters/prisma/prisma-scoped-store.adapter';
import {
  CANONICAL_TITLE_TRGM_SQL,
  DOCUMENT_AUTHOR_TRGM_SQL,
  DOCUMENT_TITLE_TRGM_SQL,
} from '../../src/l0/adapters/prisma/prisma-identity-lookup.adapter';
import { FTS_SEARCH_SQL } from '../../src/l0/adapters/prisma/prisma-retrieval-index.adapter';
import { EMBED_MODEL_VERSION } from '../../src/ai/policy/embed-policy.constants';
import {
  CONSUMED_SEARCH_INDEXES,
  HNSW_EF_CONSTRUCTION,
  HNSW_EF_SEARCH_DEFAULT,
  HNSW_INDEX_NAME,
  HNSW_M,
  HNSW_OPERATOR_CLASS,
  HNSW_WRITE_ACTIVE_MODEL_VERSION,
} from '../../src/l0/ports/hnsw.constants';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const MIGRATIONS = join(ROOT, 'prisma', 'migrations');

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

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS).filter((name) => {
    const full = join(MIGRATIONS, name);
    return statSync(full).isDirectory() && /_\d{3}_/.test(name);
  });
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('DHB-54 GAP-HNSW-01 / GAP-FTS-01 decision conformance', () => {
  const migration010 = read('prisma/migrations/20250829131000_010_embeddings/migration.sql');
  const migration016 = read('prisma/migrations/20250829131200_016_fts/migration.sql');
  const scopedAdapter = read('src/l0/adapters/prisma/prisma-scoped-store.adapter.ts');
  const retrievalAdapter = read('src/l0/adapters/prisma/prisma-retrieval-index.adapter.ts');
  const identityAdapter = read('src/l0/adapters/prisma/prisma-identity-lookup.adapter.ts');
  const identityService = read('src/retrieval/trigram-identity.ts');
  const loader = read('src/platform/config/config.loader.ts');

  it('GAP-HNSW-01: consumes the DHB-30 HNSW index and does not recreate it', () => {
    expect(HNSW_INDEX_NAME).toBe('idx_chunk_embeddings_hnsw_embedding_v1');
    expect(HNSW_OPERATOR_CLASS).toBe('vector_cosine_ops');
    expect(HNSW_M).toBe(16);
    expect(HNSW_EF_CONSTRUCTION).toBe(128);
    expect(HNSW_EF_SEARCH_DEFAULT).toBe(80);
    expect(HNSW_WRITE_ACTIVE_MODEL_VERSION).toBe(EMBED_MODEL_VERSION);
    expect(HNSW_WRITE_ACTIVE_MODEL_VERSION).toBe('embedding_v1');

    expect(migration010).toContain(`CREATE INDEX "${HNSW_INDEX_NAME}"`);
    expect(migration010).toContain(`USING hnsw ("vector" ${HNSW_OPERATOR_CLASS})`);
    expect(migration010).toContain(`WITH (m = ${HNSW_M}, ef_construction = ${HNSW_EF_CONSTRUCTION})`);
    expect(migration010).toContain(
      `WHERE "model_version" = '${HNSW_WRITE_ACTIVE_MODEL_VERSION}' AND "status" = 'ok'`,
    );

    const hnswCreates = migrationDirs().filter((dir) => {
      const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8').toLowerCase();
      return sql.includes('using hnsw');
    });
    expect(hnswCreates).toEqual(['20250829131000_010_embeddings']);

    expect(scopedAdapter).toContain(HNSW_INDEX_NAME);
    expect(scopedAdapter).toContain('SET LOCAL hnsw.ef_search');
    expect(scopedAdapter).not.toMatch(/CREATE\s+INDEX/i);
    expect(retrievalAdapter).not.toMatch(/CREATE\s+INDEX/i);
  });

  it('GAP-HNSW-01: ANN places project_id in WHERE before <=> and stays on cosine', () => {
    const projectIdAt = ANN_NEAREST_SQL.indexOf('project_id');
    const distanceAt = ANN_NEAREST_SQL.indexOf('<=>');
    expect(projectIdAt).toBeGreaterThanOrEqual(0);
    expect(distanceAt).toBeGreaterThan(projectIdAt);
    expect(ANN_NEAREST_SQL).toContain("status = 'ok'");
    expect(ANN_NEAREST_SQL).toContain(`model_version = '${HNSW_WRITE_ACTIVE_MODEL_VERSION}'`);
    expect(ANN_NEAREST_SQL).toContain('::vector(1024)');
    expect(scopedAdapter).not.toMatch(/vector_l2_ops|vector_ip_ops/);
    expect(migration010).not.toMatch(/vector_l2_ops|vector_ip_ops/);
  });

  it('GAP-FTS-01: consumes DHB-31 GIN on search_vector and document trigram indexes', () => {
    expect(migration016).toContain('CREATE INDEX "idx_chunks_fts"');
    expect(migration016).toContain('USING GIN ("search_vector")');
    expect(migration016).toContain('CREATE INDEX "idx_documents_title_trgm"');
    expect(migration016).toContain('CREATE INDEX "idx_documents_authors_trgm"');

    const ftsCreates = migrationDirs().filter((dir) => {
      const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
      return sql.includes('idx_chunks_fts');
    });
    expect(ftsCreates).toEqual(['20250829131200_016_fts']);

    const projectIdAt = FTS_SEARCH_SQL.indexOf('project_id');
    const matchAt = FTS_SEARCH_SQL.indexOf('@@');
    expect(projectIdAt).toBeGreaterThanOrEqual(0);
    expect(matchAt).toBeGreaterThan(projectIdAt);
    expect(FTS_SEARCH_SQL).toContain('c.search_vector');
    expect(FTS_SEARCH_SQL).not.toMatch(/to_tsvector\(/);

    expect(CONSUMED_SEARCH_INDEXES).toEqual([
      HNSW_INDEX_NAME,
      'idx_chunks_fts',
      'idx_documents_title_trgm',
      'idx_documents_authors_trgm',
      'idx_canonical_works_title_trgm',
    ]);
    expect(DOCUMENT_TITLE_TRGM_SQL).toContain('d.title % $1');
    expect(DOCUMENT_AUTHOR_TRGM_SQL).toContain("immutable_text_array_join(d.authors, ' ') % $1");
    expect(CANONICAL_TITLE_TRGM_SQL).toContain('cw.canonical_title % $1');
  });

  it('GAP-FTS-01 / E-2: trigram identity never merges and never writes WorkRelationship', () => {
    expect(identityAdapter).toContain("status: 'pending'");
    expect(identityAdapter).toContain("matchType: 'fuzzy_title'");
    expect(identityAdapter).toContain('mergeCandidate.create');
    expect(identityAdapter).not.toMatch(/workRelationship\.(create|createMany|update|upsert)/);
    expect(identityAdapter).not.toMatch(/INSERT INTO work_relationships/i);
    expect(identityAdapter).not.toMatch(/status:\s*'merged'/);
    expect(identityService).toContain('MergeCandidate');
    expect(identityService).not.toMatch(/workRelationship\.(create|createMany|update|upsert)/);
    expect(identityService).not.toMatch(/status:\s*'merged'/);
  });

  it('does not create a second vector or FTS authority in DHB-54 src or a new migration', () => {
    const dhb54Src = [
      'src/l0/adapters/prisma/prisma-retrieval-index.adapter.ts',
      'src/l0/adapters/prisma/prisma-identity-lookup.adapter.ts',
      'src/l0/ports/hnsw.constants.ts',
      'src/retrieval/ann-search.ts',
      'src/retrieval/lexical-search.ts',
      'src/retrieval/trigram-identity.ts',
    ];
    for (const file of dhb54Src) {
      const contents = read(file);
      expect(contents).not.toMatch(/CREATE\s+INDEX/i);
      expect(contents).not.toMatch(/using hnsw/i);
      expect(contents).not.toMatch(/elasticsearch|opensearch|pinecone|weaviate|milvus|qdrant/i);
    }

    expect(migrationDirs().some((name) => /dhb.?54/i.test(name))).toBe(false);

    for (const file of collectTs(SRC)) {
      const contents = readFileSync(file, 'utf8');
      expect(contents).not.toMatch(/CREATE\s+INDEX[\s\S]{0,80}hnsw/i);
      expect(contents).not.toMatch(/CREATE\s+INDEX[\s\S]{0,80}search_vector/i);
    }
  });

  it('rejects rebuild-only HNSW knobs at config load', () => {
    expect(loader).toContain("getSecret('HNSW_M')");
    expect(loader).toContain("getSecret('HNSW_EF_CONSTRUCTION')");
    expect(loader).toContain("getSecret('HNSW_EF_SEARCH')");
    expect(loader).toContain('hnswEfSearch');
    expect(read('src/platform/config/app-config.types.ts')).toContain('hnswEfSearch');
  });
});
