import {
  ProviderCircuitBreakerRegistry,
} from '../../src/ai/adapters/circuit-breaker';
import type { AdapterClock } from '../../src/ai/adapters/clock';
import {
  ConnectorCircuitBreakerRegistry,
} from '../../src/connectors/connector-circuit-breaker';
import type { ConnectorClock } from '../../src/connectors/connector-clock';

class FakeClock implements AdapterClock, ConnectorClock {
  nowMs = 0;
  now(): number {
    return this.nowMs;
  }
  async sleep(ms: number): Promise<void> {
    this.nowMs += ms;
  }
}

describe('DHB-70 per-dependency circuit isolation', () => {
  it('opening an arxiv breaker does not affect pubmed or AI providers', () => {
    const clock = new FakeClock();
    const connectors = new ConnectorCircuitBreakerRegistry(clock);
    const ai = new ProviderCircuitBreakerRegistry(clock);

    const arxiv = connectors.get('arxiv');
    const pubmed = connectors.get('pubmed');
    const openai = ai.get('openai');
    const voyage = ai.get('voyage');

    for (let i = 0; i < 5; i += 1) {
      expect(arxiv.allowRequest()).toBe(true);
      arxiv.recordFailure();
    }

    expect(arxiv.getState()).toBe('open');
    expect(arxiv.allowRequest()).toBe(false);

    expect(pubmed.getState()).toBe('closed');
    expect(pubmed.allowRequest()).toBe(true);

    expect(openai.getState()).toBe('closed');
    expect(openai.allowRequest()).toBe(true);
    expect(voyage.getState()).toBe('closed');
    expect(voyage.allowRequest()).toBe(true);
  });

  it('opening an AI breaker does not affect connectors', () => {
    const clock = new FakeClock();
    const connectors = new ConnectorCircuitBreakerRegistry(clock);
    const ai = new ProviderCircuitBreakerRegistry(clock);

    const voyage = ai.get('voyage');
    for (let i = 0; i < 5; i += 1) {
      voyage.allowRequest();
      voyage.recordFailure();
    }
    expect(voyage.getState()).toBe('open');

    const arxiv = connectors.get('arxiv');
    expect(arxiv.getState()).toBe('closed');
    expect(arxiv.allowRequest()).toBe(true);
  });
});
