import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const BUDGET_DIR = join(ROOT, 'src', 'orchestration', 'budget');
const COORDINATOR = join(
  ROOT,
  'src',
  'orchestration',
  'research-run-coordinator.service.ts',
);

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

describe('DHB-66 ResearchRun budget static contracts', () => {
  it('budget path uses bigint micros and never float literals for money', () => {
    const files = [...collectTs(BUDGET_DIR), COORDINATOR];
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      // Float micros literals like 1.5 or cost: 1.0 are forbidden in the budget path.
      if (/\b\d+\.\d+\s*(?:n)?\b/.test(content) && /micros|budget|ceiling|reserved|consumed/i.test(content)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] ?? '';
          if (
            /\d+\.\d+/.test(line) &&
            /micros|budget|ceiling|reserved|consumed/i.test(line) &&
            !line.trim().startsWith('*') &&
            !line.trim().startsWith('//')
          ) {
            violations.push(`${relative(ROOT, file)}:${i + 1}:${line.trim()}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps budget separate from UsageCounter and concurrency gates', () => {
    const budget = readFileSync(join(BUDGET_DIR, 'research-run-budget.ts'), 'utf8');
    const coordinator = readFileSync(COORDINATOR, 'utf8');
    expect(budget).not.toMatch(/UsageCounter|ConcurrencyGate|QuotaExceeded/);
    expect(coordinator).toMatch(/increaseBudget|resumeAfterBudgetIncrease|canReserveDispatch/);
    expect(coordinator).toMatch(/PAUSED_BUDGET/);
  });

  it('ledger still increments consumedMicros inside the write transaction', () => {
    const database = readFileSync(
      join(ROOT, 'src/l0/adapters/prisma/prisma-database.adapter.ts'),
      'utf8',
    );
    expect(database).toMatch(/recordAiExecutionLedger/);
    expect(database).toMatch(/\$transaction/);
    expect(database).toMatch(/consumedMicros:\s*\{\s*increment/);
  });
});
