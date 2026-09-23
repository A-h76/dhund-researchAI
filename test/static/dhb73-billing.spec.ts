import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const BILLING = join(ROOT, 'src', 'billing');

function collect(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collect(fullPath));
      continue;
    }
    if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('DHB-73 GAP-PLAN-01', () => {
  const files = collect(BILLING);

  it('does not name tiers or assign numeric plan caps', () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const path = relative(ROOT, file).replace(/\\/g, '/');
      if (/\bFREE\b|\bPRO\b|\bTEAM\b/.test(content)) {
        violations.push(`${path} names a plan tier`);
      }
      if (
        /\b(cap|quota|limit|maxDocuments|maxSeats|maxTokens|maxStorage|aiTokens)\s*[:=]\s*\d/.test(
          content,
        )
      ) {
        violations.push(`${path} assigns a numeric cap`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('derives entitlement from code and links orgs only through metadata.org_id', () => {
    const entitlement = readFileSync(join(BILLING, 'entitlement.ts'), 'utf8');
    const stripeEvent = readFileSync(join(BILLING, 'stripe-event.ts'), 'utf8');
    expect(entitlement).not.toMatch(/metadata/);
    expect(stripeEvent).toContain('metadata.org_id');
    expect(stripeEvent).not.toMatch(/metadata\.plan|metadata\.entitlement|metadata\.seats/);
  });

  it('keeps billing quota off the concurrency gate', () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*concurrency/.test(content) || content.includes('BatchConcurrencyGate')) {
        violations.push(relative(ROOT, file).replace(/\\/g, '/'));
      }
    }
    expect(violations).toEqual([]);
  });
});
