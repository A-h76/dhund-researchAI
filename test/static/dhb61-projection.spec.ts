import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

describe('DHB-61 §19.3 projection contracts', () => {
  it('walks real relations instead of a denormalised projection table', () => {
    const service = readFileSync(
      join(SRC_ROOT, 'evidence', 'sentence-projection.service.ts'),
      'utf8',
    );
    expect(service).toMatch(/findEvidence/);
    expect(service).toMatch(/findSource/);
    expect(service).toMatch(/findChunkInProject/);
    expect(service).toMatch(/getVersionWithDocument/);
    expect(service).toMatch(/listEvidenceForExecution/);
    expect(service).not.toMatch(/sentence_evidence_projection/);
    expect(service).not.toMatch(/FROM sentence_bindings_denorm/i);
  });

  it('exposes GET /v1/writing/:writingId/sentence-bindings/:hash and no writing mutation API', () => {
    const controller = readFileSync(
      join(SRC_ROOT, 'apps', 'api', 'writing-sentence-bindings.controller.ts'),
      'utf8',
    );
    expect(controller).toMatch(/v1\/writing/);
    expect(controller).toMatch(/:writingId\/sentence-bindings\/:hash/);
    expect(controller).not.toMatch(/@Post/);
    expect(controller).not.toMatch(/@Patch/);
    expect(controller).not.toMatch(/@Put/);
    expect(controller).not.toMatch(/@Delete/);
  });

  it('keeps citation exclusivity in the repository', () => {
    const citations = readFileSync(join(SRC_ROOT, 'evidence', 'citations.service.ts'), 'utf8');
    expect(citations).toMatch(/exactly one/);
    const adapter = readFileSync(
      join(SRC_ROOT, 'l0', 'adapters', 'prisma', 'prisma-citation-projection.adapter.ts'),
      'utf8',
    );
    expect(adapter).toMatch(/exactly one target/);
  });
});
