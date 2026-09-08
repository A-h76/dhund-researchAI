import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');
const GATEWAY_SERVICE = join(SRC_ROOT, 'ai', 'gateway', 'gateway.service.ts');
const AI_MODULE = join(SRC_ROOT, 'ai', 'ai.module.ts');
const BOUNDARY_ROOT = join(SRC_ROOT, 'ai', 'boundary');
const ORCHESTRATION_ROOT = join(SRC_ROOT, 'orchestration');
const WORKER_ROOT = join(SRC_ROOT, 'apps', 'worker');

const FORBIDDEN_WORDING =
  /PHI detection|detects PHI|detect PHI in content|content classifier/i;

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

function normalized(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, '/');
}

describe('DHB-47 data-boundary static checks', () => {
  it('invokes the boundary check before adapter dispatch in GatewayService.execute', () => {
    const source = readFileSync(GATEWAY_SERVICE, 'utf8');
    const executeStart = source.indexOf('async execute(');
    const executeBody = source.slice(executeStart);
    const boundaryIdx = executeBody.indexOf('this.boundary.assertAllowed');
    const getIdx = executeBody.indexOf('this.adapterRegistry.get');
    const invokeIdx = executeBody.indexOf('adapter.invoke');

    expect(boundaryIdx).toBeGreaterThan(-1);
    expect(getIdx).toBeGreaterThan(boundaryIdx);
    expect(invokeIdx).toBeGreaterThan(getIdx);
  });

  it('binds the real data-boundary checker in production AiModule', () => {
    const source = readFileSync(AI_MODULE, 'utf8');
    expect(source).toMatch(/GatewayDataBoundary/);
    expect(source).toMatch(/DATA_BOUNDARY_CHECK/);
    expect(source).not.toMatch(/NoopDataBoundary/);
  });

  it('does not describe the boundary as PHI detection or a content classifier', () => {
    const violations: string[] = [];
    for (const file of collectFiles(BOUNDARY_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (FORBIDDEN_WORDING.test(content)) {
        violations.push(normalized(file));
      }
    }
    const gateway = readFileSync(GATEWAY_SERVICE, 'utf8');
    if (FORBIDDEN_WORDING.test(gateway)) {
      violations.push('src/ai/gateway/gateway.service.ts');
    }
    expect(violations).toEqual([]);
  });

  it('keeps adapter invocation out of the orchestration module', () => {
    const violations: string[] = [];
    for (const file of collectFiles(ORCHESTRATION_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (
        content.includes("from '../ai/adapters") ||
        content.includes("from '../../ai/adapters") ||
        /adapter\.invoke/.test(content)
      ) {
        violations.push(normalized(file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps worker processors from calling adapters directly', () => {
    const violations: string[] = [];
    for (const file of collectFiles(WORKER_ROOT)) {
      const path = normalized(file);
      if (path.endsWith('worker-app.module.ts')) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      if (
        /from ['"].*ai\/adapters/.test(content) ||
        /adapter\.invoke/.test(content)
      ) {
        violations.push(path);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps the audit-event port free of Prisma types', () => {
    const port = readFileSync(join(SRC_ROOT, 'l0', 'ports', 'audit-event.port.ts'), 'utf8');
    expect(port).toMatch(/append\(/);
    expect(port).not.toMatch(/Prisma/);
  });

  it('types objectKey onto OCR only and has no presigned URL or byte fields on GatewayRequest', () => {
    const types = readFileSync(join(SRC_ROOT, 'ai', 'gateway', 'gateway.types.ts'), 'utf8');
    const requestBlock = types.slice(
      types.indexOf('export type GatewayRequest'),
      types.indexOf('export interface AssembledProviderPayload'),
    );
    expect(requestBlock).toMatch(/capability: 'OCR'/);
    expect(requestBlock).toMatch(/objectKey: string/);
    expect(requestBlock).not.toMatch(/presignedUrl/);
    expect(requestBlock).not.toMatch(/Buffer/);
    expect(requestBlock).not.toMatch(/Uint8Array/);
    expect(requestBlock).not.toMatch(/DERIVATION/);

    const objectKeyCount = (requestBlock.match(/objectKey/g) ?? []).length;
    expect(objectKeyCount).toBe(1);
  });
});
