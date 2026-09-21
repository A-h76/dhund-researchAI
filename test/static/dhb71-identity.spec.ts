import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeMatchObservabilityLabel,
} from '../../src/l0/ports/identity-spine.port';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const SCHEMA = join(ROOT, 'prisma', 'schema.prisma');

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

describe('DHB-71 static contracts — no WorkEmbedding; honesty + R9', () => {
  it('schema and src contain no WorkEmbedding table or code path', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    expect(schema).not.toMatch(/WorkEmbedding|work_embeddings/i);
    expect(schema).toContain('model CanonicalWork');
    expect(schema).toContain('model MergeCandidate');
    expect(schema).toContain('model ExternalRecord');
    expect(schema).toContain('staleAt');

    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/WorkEmbedding/);
      expect(content).not.toMatch(/work_embeddings/);
      expect(content).not.toMatch(/embedding[\s_-]*similarity/i);
    }
  });

  it('identity matching paths do not use embedding similarity', () => {
    const identityDir = join(SRC, 'identity');
    for (const file of collectTs(identityDir)) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/embedding/i);
      expect(content).not.toMatch(/cosine|hnsw|vector/i);
    }
  });

  it('maps schema fuzzy_title / exact_doi to ticket observability labels', () => {
    expect(mergeMatchObservabilityLabel('fuzzy_title')).toBe('fuzzy_only');
    expect(mergeMatchObservabilityLabel('exact_doi')).toBe('doi_exact');
  });

  it('E-2: identity merge service forbids fuzzy_title merges in source', () => {
    const merge = readFileSync(join(SRC, 'identity/identity-merge.service.ts'), 'utf8');
    expect(merge).toContain("matchType === 'fuzzy_title'");
    expect(merge).toContain('honesty invariant');
    expect(merge).not.toMatch(/status:\s*'merged'[\s\S]{0,80}fuzzy_title/);
  });

  it('refmgr-import admits via requestExtractJob (R9), not a second extract path', () => {
    const refmgr = readFileSync(join(SRC, 'external-records/refmgr-import.service.ts'), 'utf8');
    expect(refmgr).toContain('requestExtractJob');
    expect(refmgr).not.toMatch(/enqueue\('extract'/);
    expect(refmgr).not.toMatch(/enqueue\("extract"/);
  });

  it('R10 append-only trigger still present for external_record_snapshots', () => {
    const migration = readFileSync(
      join(ROOT, 'prisma/migrations/20250829130800_008_rights_external/migration.sql'),
      'utf8',
    );
    expect(migration).toContain('trg_external_record_snapshots_reject_update');
    expect(migration).toContain('trg_reject_update_append_only');
  });
});
