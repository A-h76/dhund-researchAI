import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function collectTs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
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

describe('DHB-68 static single-owner + evidence-grounding contracts', () => {
  it('has exactly one ResearchRunCoordinatorService — extraction does not add an orchestrator', () => {
    const coordinators: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      if (/export\s+class\s+\w*Coordinator\w*/.test(content)) {
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (/CoordinatorService/.test(content)) {
          coordinators.push(rel);
        }
      }
    }
    expect(coordinators).toEqual(['src/orchestration/research-run-coordinator.service.ts']);
    expect(read('src/orchestration/research-run-coordinator.service.ts')).toContain(
      'dispatchCellsForRun',
    );
    expect(read('src/orchestration/extraction-matrix.service.ts')).not.toMatch(
      /class\s+\w*Coordinator/,
    );
  });

  it('extraction cell path uses canonical IRetrievalService only — no private retriever', () => {
    const cell = read('src/orchestration/extraction-cell.service.ts');
    expect(cell).toContain('RETRIEVAL_SERVICE');
    expect(cell).toContain('IRetrievalService');
    expect(cell).toContain('retrieval.retrieve');
    expect(cell).toContain('retrieval.trace');
    expect(cell).not.toMatch(/class\s+\w*Retriever/);
    expect(cell).not.toMatch(/private\s+retriev/i);

    const implementors: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      if (/class\s+\w+\s+implements\s+IRetrievalService/.test(content)) {
        implementors.push(
          relative(ROOT, file).replace(/\\/g, '/'),
        );
      }
    }
    expect(implementors).toEqual(['src/retrieval/retrieval.service.ts']);
  });

  it('ok cells require locator + aiExecutionId; failures write null value', () => {
    const cell = read('src/orchestration/extraction-cell.service.ts');
    expect(cell).toMatch(/evidenceLocator:\s*locator/);
    expect(cell).toMatch(/aiExecutionId/);
    expect(cell).toMatch(/status:\s*'failed'/);
    expect(cell).toMatch(/value:\s*null/);
    expect(cell).toMatch(/never invent/i);
  });

  it('batch assembly shares grounded context rules with DHB-62', () => {
    const batch = read('src/orchestration/extraction-batch-context.ts');
    const chat = read('src/orchestration/chat-context.ts');
    expect(batch).toContain('assembleGroundedContext');
    expect(chat).toContain('assembleGroundedContext');
    expect(batch).toContain('CONTEXT_ASSEMBLY_MAX_CHUNKS');
    expect(chat).toContain('CONTEXT_ASSEMBLY_MAX_CHUNKS');
  });
});
