import { AdapterError } from '../../src/ai/adapters/adapter.errors';
import { ProviderCircuitBreakerRegistry } from '../../src/ai/adapters/circuit-breaker';
import type { AdapterClock } from '../../src/ai/adapters/clock';
import { walkFallbackChain } from '../../src/ai/adapters/fallback-chain';
import type { CapabilityInvokeResult } from '../../src/ai/gateway/gateway.types';

class FakeClock implements AdapterClock {
  nowMs = 0;
  now(): number {
    return this.nowMs;
  }
  async sleep(ms: number): Promise<void> {
    this.nowMs += ms;
  }
}

const chatResult: CapabilityInvokeResult = {
  capability: 'CHAT',
  text: 'ok',
  inputFingerprint: 'fp',
  promptVersion: 'chat_v1',
  provider: 'openai',
  model: 'primary',
  metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 15 },
};

describe('walkFallbackChain (DHB-46)', () => {
  it('walks the chain and records every attempt until success', async () => {
    const breakers = new ProviderCircuitBreakerRegistry(new FakeClock());
    const outcome = await walkFallbackChain(
      [
        {
          provider: 'openai',
          model: 'primary',
          method: 'llm',
          invoke: async () => {
            throw new AdapterError('unavailable', 'down');
          },
        },
        {
          provider: 'openai',
          model: 'primary',
          method: 'deterministic',
          skipBreaker: true,
          invoke: async () => ({
            result: { ...chatResult, text: 'deterministic-fallback' },
            tokensIn: 0,
            tokensOut: 0,
            costMicros: 0,
            latencyMs: 1,
          }),
        },
      ],
      breakers,
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.method).toBe('deterministic');
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.attempts[0]?.status).toBe('failed');
    expect(outcome.attempts[1]?.status).toBe('ok');
  });

  it('does not substitute a different-dimension EMBED hop', async () => {
    const breakers = new ProviderCircuitBreakerRegistry(new FakeClock());
    const outcome = await walkFallbackChain(
      [
        {
          provider: 'voyage',
          model: 'primary-embed',
          method: 'llm',
          invoke: async () => {
            throw new AdapterError('unavailable', 'voyage down');
          },
        },
      ],
      breakers,
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.result).toBeUndefined();
  });

  it('records a circuit_open attempt and continues to a skipBreaker hop', async () => {
    const breakers = new ProviderCircuitBreakerRegistry(new FakeClock());
    const openai = breakers.get('openai');
    for (let i = 0; i < 5; i += 1) {
      openai.allowRequest();
      openai.recordFailure();
    }

    const outcome = await walkFallbackChain(
      [
        {
          provider: 'openai',
          model: 'primary',
          method: 'llm',
          invoke: async () => ({
            result: chatResult,
            tokensIn: 1,
            tokensOut: 1,
            costMicros: 15,
            latencyMs: 1,
          }),
        },
        {
          provider: 'openai',
          model: 'primary',
          method: 'deterministic',
          skipBreaker: true,
          invoke: async () => ({
            result: { ...chatResult, text: 'deterministic-fallback' },
            tokensIn: 0,
            tokensOut: 0,
            costMicros: 0,
            latencyMs: 1,
          }),
        },
      ],
      breakers,
    );

    expect(outcome.attempts[0]?.error).toBe('circuit_open');
    expect(outcome.method).toBe('deterministic');
    expect(outcome.status).toBe('ok');
  });
});
