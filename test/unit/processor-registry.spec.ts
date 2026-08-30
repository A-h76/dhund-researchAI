import { ProcessorRegistry } from '../../src/apps/worker/processor-registry';

describe('processor registry R1 inventory guard', () => {
  it('rejects R1 processor registration for screening and derivation', () => {
    const registry = new ProcessorRegistry();
    expect(() => registry.register('screening')).toThrow(
      'must not register an R1 processor',
    );
    expect(() => registry.register('derivation')).toThrow(
      'must not register an R1 processor',
    );
  });

  it('lists R1-eligible queues excluding forward-compatible inventory entries', () => {
    const registry = new ProcessorRegistry();
    const eligible = registry.listR1EligibleQueues();
    expect(eligible).not.toContain('screening');
    expect(eligible).not.toContain('derivation');
    expect(eligible).toHaveLength(23);
  });
});
