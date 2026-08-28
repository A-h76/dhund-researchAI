import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const FIXTURE = 'test/fixtures/eslint/l3-imports-l4.ts';

describe('eslint import direction', () => {
  it('fails on deliberate L3 -> L4 import', () => {
    expect(() => {
      execSync(`npx eslint --no-ignore "${FIXTURE}"`, {
        cwd: ROOT,
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).toThrow();
  });
});
