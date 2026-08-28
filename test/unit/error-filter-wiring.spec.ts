import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

describe('error filter module wiring', () => {
  it('registers the filter only in the API app module', () => {
    const api = readFileSync(join(ROOT, 'src/apps/api/api-app.module.ts'), 'utf8');
    const worker = readFileSync(
      join(ROOT, 'src/apps/worker/worker-app.module.ts'),
      'utf8',
    );

    expect(api).toContain('GlobalExceptionFilter');
    expect(api).toContain('APP_FILTER');
    expect(worker).not.toContain('GlobalExceptionFilter');
    expect(worker).not.toContain('APP_FILTER');
  });

  it('keeps worker bootstrap HTTP-free', () => {
    const main = readFileSync(join(ROOT, 'src/main.ts'), 'utf8');
    expect(main).toContain('createApplicationContext(WorkerAppModule');
    expect(main).toContain('create(ApiAppModule');
  });
});
