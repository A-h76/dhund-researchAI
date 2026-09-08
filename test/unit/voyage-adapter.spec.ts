import { AdapterError } from '../../src/ai/adapters/adapter.errors';
import { ProviderCircuitBreakerRegistry } from '../../src/ai/adapters/circuit-breaker';
import type { AdapterClock } from '../../src/ai/adapters/clock';
import { invokeWith429Backoff, type VoyageEmbedClient } from '../../src/ai/adapters/voyage/voyage-client';
import { VoyageEmbedAdapter } from '../../src/ai/adapters/voyage/voyage-embed.adapter';
import { EMBED_DIMENSION } from '../../src/ai/policy/embed-policy.constants';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import type { GatewayContext } from '../../src/ai/gateway/gateway.types';
import { RuntimeRole } from '../../src/platform/runtime/role';
import type { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

class FakeClock implements AdapterClock {
  nowMs = 1_000;
  sleeps: number[] = [];

  now(): number {
    return this.nowMs;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.nowMs += ms;
  }
}

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
} as unknown as PlatformLogger;

function workerContext(): GatewayContext {
  return {
    orgId: '00000000-0000-7000-8000-000000000001',
    correlationId: 'corr-worker',
    runtimeRole: RuntimeRole.Worker,
  };
}

describe('Voyage adapter (DHB-46)', () => {
  it('retries 429 with backoff instead of surfacing a hard failure', async () => {
    const clock = new FakeClock();
    let calls = 0;

    const result = await invokeWith429Backoff(async () => {
      calls += 1;
      if (calls < 3) {
        throw { status: 429 };
      }
      return 'ok';
    }, clock);

    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual([100, 200]);
  });

  it('honours input_type and locked 1024 dimensions', async () => {
    const client: VoyageEmbedClient = {
      embed: async (request) => ({
        vectors: request.texts.map(() => Array.from({ length: EMBED_DIMENSION }, () => 0.01)),
        tokensIn: 4,
        latencyMs: 2,
      }),
    };
    const adapter = new VoyageEmbedAdapter(
      client,
      new ProviderCircuitBreakerRegistry(new FakeClock()),
      logger,
    );
    const request = {
      capability: 'EMBED' as const,
      texts: ['alpha'],
      inputType: 'query' as const,
    };
    const policy = new PolicyResolver().resolve(request);
    const outcome = await adapter.invoke({
      ctx: workerContext(),
      policy,
      payload: new PromptAssembler().assemble(request, policy),
      request,
    });

    expect(outcome.status).toBe('ok');
    expect(outcome.attempts).toHaveLength(1);
    if (outcome.result?.capability !== 'EMBED') {
      throw new Error('expected embed result');
    }
    expect(outcome.result.inputType).toBe('query');
    expect(outcome.result.vectors[0]).toHaveLength(EMBED_DIMENSION);
    expect(Number.isInteger(outcome.costMicros)).toBe(true);
  });

  it('fails closed when Voyage is down instead of falling back across dimensions', async () => {
    const client: VoyageEmbedClient = {
      embed: async () => {
        throw new AdapterError('unavailable', 'voyage down');
      },
    };
    const adapter = new VoyageEmbedAdapter(
      client,
      new ProviderCircuitBreakerRegistry(new FakeClock()),
      logger,
    );
    const request = {
      capability: 'EMBED' as const,
      texts: ['alpha'],
      inputType: 'document' as const,
    };
    const policy = new PolicyResolver().resolve(request);
    const outcome = await adapter.invoke({
      ctx: workerContext(),
      policy,
      payload: new PromptAssembler().assemble(request, policy),
      request,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.result).toBeUndefined();
  });
});
