import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('DHB-59 evidence-extract / stance pipeline contracts', () => {
  it('routes both jobs through IGatewayService.execute', () => {
    const extract = readFileSync(
      join(SRC_ROOT, 'apps', 'worker', 'evidence-extract.service.ts'),
      'utf8',
    );
    const stance = readFileSync(join(SRC_ROOT, 'apps', 'worker', 'stance.service.ts'), 'utf8');
    expect(extract).toMatch(/GATEWAY_SERVICE/);
    expect(extract).toMatch(/capability:\s*'EVIDENCE_EXTRACT'/);
    expect(stance).toMatch(/GATEWAY_SERVICE/);
    expect(stance).toMatch(/capability:\s*'STANCE'/);
  });

  it('registers research-run-step and stance worker processors', () => {
    const workerModule = readFileSync(
      join(SRC_ROOT, 'apps', 'worker', 'worker-app.module.ts'),
      'utf8',
    );
    expect(workerModule).toMatch(/EvidenceExtractProcessor/);
    expect(workerModule).toMatch(/StanceProcessor/);
  });

  it('does not import a provider SDK from the evidence or worker job modules', () => {
    const roots = [
      join(SRC_ROOT, 'evidence'),
      join(SRC_ROOT, 'apps', 'worker', 'evidence-extract.service.ts'),
      join(SRC_ROOT, 'apps', 'worker', 'stance.service.ts'),
    ];
    const files = roots.flatMap((root) =>
      statSync(root).isDirectory() ? collectFiles(root) : [root],
    );
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/from ['"]openai['"]/);
      expect(content).not.toMatch(/from ['"]@anthropic/);
      expect(content).not.toMatch(/from ['"]voyageai['"]/);
    }
  });

  it('keeps document text inside structural delimiters in the extract prompt', () => {
    const assembler = readFileSync(join(SRC_ROOT, 'ai', 'policy', 'prompt-assembler.ts'), 'utf8');
    expect(assembler).toMatch(/EVIDENCE_EXTRACT/);
    expect(assembler).toMatch(/locator_catalog/);
    expect(assembler).toMatch(/DOCUMENT_OPEN|wrapDocument/);
  });
});
