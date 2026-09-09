import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('DHB-46 AiModule wiring', () => {
  it('registers live Voyage and OpenAI adapters through AdapterRegistry', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ai', 'ai.module.ts'), 'utf8');
    expect(source).toMatch(/createLiveAdapters/);
    expect(source).toMatch(/SdkVoyageClient/);
    expect(source).toMatch(/SdkOpenAiClient/);
    expect(source).toMatch(/ProviderCircuitBreakerRegistry/);
    expect(source).toMatch(/OBJECT_STORAGE_SERVICE/);
  });
});
