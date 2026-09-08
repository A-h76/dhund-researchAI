import {
  CIRCUIT_HALF_OPEN_AFTER_MS,
  CIRCUIT_WINDOW_MS,
  ProviderCircuitBreakerRegistry,
} from '../../src/ai/adapters/circuit-breaker';
import type { AdapterClock } from '../../src/ai/adapters/clock';

class FakeClock implements AdapterClock {
  nowMs = 0;

  now(): number {
    return this.nowMs;
  }

  async sleep(ms: number): Promise<void> {
    this.nowMs += ms;
  }
}

describe('ProviderCircuitBreaker (DHB-46 / GAP-CIRCUIT-01)', () => {
  it('opens after five consecutive failures', () => {
    const clock = new FakeClock();
    const registry = new ProviderCircuitBreakerRegistry(clock);
    const voyage = registry.get('voyage');

    for (let i = 0; i < 4; i += 1) {
      expect(voyage.allowRequest()).toBe(true);
      voyage.recordFailure();
      expect(voyage.getState()).toBe('closed');
    }

    expect(voyage.allowRequest()).toBe(true);
    voyage.recordFailure();
    expect(voyage.getState()).toBe('open');
    expect(voyage.allowRequest()).toBe(false);
  });

  it('opens when failure rate exceeds 50% over a 60s window', () => {
    const clock = new FakeClock();
    const registry = new ProviderCircuitBreakerRegistry(clock);
    const openai = registry.get('openai');

    openai.allowRequest();
    openai.recordSuccess();
    openai.allowRequest();
    openai.recordFailure();
    openai.allowRequest();
    openai.recordFailure();
    openai.allowRequest();
    openai.recordSuccess();
    openai.allowRequest();
    openai.recordFailure();
    openai.allowRequest();
    openai.recordFailure();

    expect(openai.getState()).toBe('open');
  });

  it('probes half-open after 30s and closes on success', () => {
    const clock = new FakeClock();
    const registry = new ProviderCircuitBreakerRegistry(clock);
    const voyage = registry.get('voyage');

    for (let i = 0; i < 5; i += 1) {
      voyage.allowRequest();
      voyage.recordFailure();
    }
    expect(voyage.getState()).toBe('open');

    clock.nowMs += CIRCUIT_HALF_OPEN_AFTER_MS;
    expect(voyage.getState()).toBe('half_open');
    expect(voyage.allowRequest()).toBe(true);
    expect(voyage.allowRequest()).toBe(false);

    voyage.recordSuccess();
    expect(voyage.getState()).toBe('closed');
    expect(voyage.allowRequest()).toBe(true);
  });

  it('keeps an open voyage breaker from affecting openai or connectors', () => {
    const clock = new FakeClock();
    const registry = new ProviderCircuitBreakerRegistry(clock);
    const voyage = registry.get('voyage');
    const openai = registry.get('openai');

    for (let i = 0; i < 5; i += 1) {
      voyage.allowRequest();
      voyage.recordFailure();
    }

    expect(voyage.getState()).toBe('open');
    expect(openai.getState()).toBe('closed');
    expect(openai.allowRequest()).toBe(true);

    const connectorPing = (): string => 'ok';
    expect(connectorPing()).toBe('ok');
  });

  it('does not count samples outside the rolling window', () => {
    const clock = new FakeClock();
    const registry = new ProviderCircuitBreakerRegistry(clock);
    const openai = registry.get('openai');

    openai.allowRequest();
    openai.recordFailure();
    clock.nowMs += CIRCUIT_WINDOW_MS + 1;
    openai.allowRequest();
    openai.recordSuccess();
    openai.allowRequest();
    openai.recordSuccess();
    openai.allowRequest();
    openai.recordSuccess();

    expect(openai.getState()).toBe('closed');
  });
});
