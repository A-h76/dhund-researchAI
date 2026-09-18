import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONFIG_ROOT = join(__dirname, '..', '..', 'src', 'platform', 'config');
const AI_ROOT = join(__dirname, '..', '..', 'src', 'ai');
const SRC_ROOT = join(__dirname, '..', '..', 'src');

function collectFiles(dir: string, extension = '.ts'): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath, extension));
      continue;
    }
    if (entry.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('DHB-44 AI gateway static checks', () => {
  it('has no configurable embedding dimension in the config schema/types', () => {
    const schemaFiles = [
      join(CONFIG_ROOT, 'config.schema.ts'),
      join(CONFIG_ROOT, 'app-config.types.ts'),
    ];
    const contents = schemaFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(contents).not.toMatch(/embeddingDimension/);
    expect(contents).not.toMatch(/parseEmbeddingDimension/);
  });

  it('rejects legacy embedding-dimension env at boot without exposing a configurable dimension', () => {
    const loader = readFileSync(join(CONFIG_ROOT, 'config.loader.ts'), 'utf8');
    expect(loader).toMatch(/getSecret\('EMBEDDING_DIMENSION'\)/);
    expect(loader).not.toMatch(/parseEmbeddingDimension/);
    expect(loader).not.toMatch(/embeddingDimension:/);
  });

  it('keeps provider/model constants inside approved ai policy and adapter paths', () => {
    const allowedPattern = /\/ai\/(policy|adapters)\//;
    const excludedFiles = new Set([
      'src/platform/errors/leakage-guard.ts',
      // Layer-local copies asserted equal to AI policy; those layers cannot import ai/.
      'src/ingestion/chunk.constants.ts',
      'src/l0/ports/hnsw.constants.ts',
    ]);
    const forbiddenPatterns = [
      /\bvoyage-4\b/,
      /\bembedding_v1\b/,
      /\bgpt-4o-mini\b/,
      /\bapi\.openai\.com\b/,
      /\bapi\.voyageai\.com\b/,
    ];

    const violations: string[] = [];

    for (const file of collectFiles(SRC_ROOT)) {
      const normalized = relative(process.cwd(), file).replace(/\\/g, '/');
      if (allowedPattern.test(normalized) || excludedFiles.has(normalized)) {
        continue;
      }

      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push(`${normalized}: ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('uses stub adapters with no network or provider SDK imports', () => {
    const stubFiles = collectFiles(join(AI_ROOT, 'adapters', 'stub'));
    const contents = stubFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(contents).not.toMatch(/\bfetch\s*\(/);
    expect(contents).not.toMatch(/\baxios\b/);
    expect(contents).not.toMatch(/\bundici\b/);
    expect(contents).not.toMatch(/\bopenai\b/);
    expect(contents).not.toMatch(/\bvoyageai\b/);
  });
});
