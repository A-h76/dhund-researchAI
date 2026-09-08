import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const AI_ROOT = join(__dirname, '..', '..', 'src', 'ai');
const L0_ROOT = join(__dirname, '..', '..', 'src', 'l0');

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

describe('DHB-45 AI execution ledger static checks', () => {
  it('keeps Prisma imports out of src/ai', () => {
    const violations: string[] = [];

    for (const file of collectFiles(AI_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('@prisma/client') || content.includes('PrismaClient')) {
        violations.push(relative(process.cwd(), file));
      }
    }

    expect(violations).toEqual([]);
  });

  it('defines AiExecutionLedgerPort behind L0', () => {
    const port = readFileSync(join(L0_ROOT, 'ports', 'ai-execution-ledger.port.ts'), 'utf8');
    expect(port).toMatch(/record\(/);
    expect(port).not.toMatch(/Prisma/);
  });

  it('registers the ledger adapter in L0Module', () => {
    const moduleSource = readFileSync(join(L0_ROOT, 'l0.module.ts'), 'utf8');
    expect(moduleSource).toMatch(/AI_EXECUTION_LEDGER/);
    expect(moduleSource).toMatch(/PrismaAiExecutionLedgerAdapter/);
  });

  it('registers the audit-event adapter in L0Module', () => {
    const moduleSource = readFileSync(join(L0_ROOT, 'l0.module.ts'), 'utf8');
    expect(moduleSource).toMatch(/AUDIT_EVENT/);
    expect(moduleSource).toMatch(/PrismaAuditEventAdapter/);
  });

  it('GatewayService injects the ledger port rather than Prisma', () => {
    const gatewaySource = readFileSync(join(AI_ROOT, 'gateway', 'gateway.service.ts'), 'utf8');
    expect(gatewaySource).toMatch(/AiExecutionLedgerPort/);
    expect(gatewaySource).not.toMatch(/PrismaClient/);
  });
});
