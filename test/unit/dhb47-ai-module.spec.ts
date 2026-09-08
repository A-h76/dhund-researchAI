import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('DHB-47 AiModule wiring', () => {
  it('registers GatewayDataBoundary as the production data-boundary check', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ai', 'ai.module.ts'), 'utf8');
    expect(source).toMatch(/GatewayDataBoundary/);
    expect(source).toMatch(/BoundaryMetrics/);
    expect(source).not.toMatch(/NoopDataBoundary/);
  });
});
