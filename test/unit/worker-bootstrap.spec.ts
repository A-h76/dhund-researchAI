import { Test } from '@nestjs/testing';
import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';
import { PlaceholderProcessor } from '../../src/apps/worker/placeholder.processor';

describe('worker bootstrap processor readiness', () => {
  it('registers the placeholder processor in the registry', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ProcessorRegistry, PlaceholderProcessor],
    }).compile();

    await moduleRef.init();

    const registry = moduleRef.get(ProcessorRegistry);
    expect(registry.hasProcessors()).toBe(true);
    expect(registry.listProcessors()).toContain('health.ping');

    await moduleRef.close();
  });

  it('remains without processors until registration runs', () => {
    const registry = new ProcessorRegistry();
    expect(registry.hasProcessors()).toBe(false);
  });
});
