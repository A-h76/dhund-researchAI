import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';
import { R1_FORWARD_COMPAT_QUEUES } from '../../src/platform/queues';

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

describe('DHB-69 GAP-CAT-A-01 P2 screening R1/R2 boundary', () => {
  it('keeps screening and derivation as forward-compat queues without R1 processors', () => {
    expect(R1_FORWARD_COMPAT_QUEUES).toEqual(['screening', 'derivation']);
    const registry = new ProcessorRegistry();
    expect(() => registry.register('screening')).toThrow(/must not register an R1 processor/);
    expect(() => registry.register('derivation')).toThrow(/must not register an R1 processor/);
  });

  it('has no screening or derivation processor implementations in src/', () => {
    const offenders: string[] = [];
    for (const file of collectTs(SRC)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (
        /screening\.processor\.ts$/.test(rel) ||
        /derivation\.processor\.ts$/.test(rel) ||
        /screening-job\.consumer\.ts$/.test(rel) ||
        /derivation-job\.consumer\.ts$/.test(rel)
      ) {
        offenders.push(rel);
      }
      const content = readFileSync(file, 'utf8');
      if (
        /processors\.register\(\s*['"]screening['"]\s*\)/.test(content) ||
        /processors\.register\(\s*['"]derivation['"]\s*\)/.test(content)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exposes screening decision stub routes and no criteria CRUD surface', () => {
    const controller = read('src/orchestration/screening-decisions.controller.ts');
    expect(controller).toContain("@Controller('v1/projects/:projectId/screening/decisions')");
    expect(controller).toContain('@Post()');
    expect(controller).toContain('@Get()');
    expect(controller).toContain("reverse");
    expect(controller).not.toMatch(/screening\/criteria/i);
    expect(controller).not.toMatch(/createCriteria|updateCriteria|deleteCriteria/i);

    const criteriaControllers: string[] = [];
    for (const file of collectTs(SRC)) {
      const content = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (
        /@Controller\([^)]*screening\/criteria/.test(content) ||
        /class\s+\w*ScreeningCriteria\w*Controller/.test(content)
      ) {
        criteriaControllers.push(rel);
      }
      if (
        /class\s+\w*ScreeningCriteria\w*Service/.test(content) &&
        /(createCriteria|updateCriteria|deleteCriteria|listCriteria)/.test(content)
      ) {
        criteriaControllers.push(rel);
      }
    }
    expect(criteriaControllers).toEqual([]);

    const stub = read('src/orchestration/screening-stub.service.ts');
    expect(stub).toContain('recordDecision');
    expect(stub).toContain('reverseDecision');
    expect(stub).not.toMatch(/createCriteria|updateCriteria|versionCriteria/);
  });

  it('registers a live synthesis processor and still forbids screening/derivation', () => {
    const worker = read('src/apps/worker/worker-app.module.ts');
    expect(worker).toContain('SynthesisProcessor');
    expect(worker).not.toContain('ScreeningProcessor');
    expect(worker).not.toContain('DerivationProcessor');
    expect(read('src/apps/worker/synthesis.processor.ts')).toContain(
      "this.processors.register('synthesis')",
    );
  });
});
