import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findLayerViolations } from '../../src/platform/layering/layer-rules';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

function collectSourceFiles(dir: string): Array<{ path: string; content: string }> {
  const entries = readdirSync(dir);
  const files: Array<{ path: string; content: string }> = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!entry.endsWith('.ts')) {
      continue;
    }

    files.push({
      path: relative(process.cwd(), fullPath),
      content: readFileSync(fullPath, 'utf8'),
    });
  }

  return files;
}

describe('import direction (static)', () => {
  it('has no upward layer imports in src/', () => {
    const violations = findLayerViolations(collectSourceFiles(SRC_ROOT));
    expect(violations).toEqual([]);
  });

  it('detects deliberate L3 -> L4 violation', () => {
    const violations = findLayerViolations([
      {
        path: 'src/projects/bad-import.example.ts',
        content: "import { IngestionModule } from '@ingestion/ingestion.module';",
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      importerLayer: 'projects',
      importedLayer: 'ingestion',
    });
  });
});
