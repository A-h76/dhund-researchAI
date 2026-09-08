import { AdapterError } from '../../src/ai/adapters/adapter.errors';
import { ProviderCircuitBreakerRegistry } from '../../src/ai/adapters/circuit-breaker';
import type { AdapterClock } from '../../src/ai/adapters/clock';
import { OpenAiCapabilityAdapter } from '../../src/ai/adapters/openai/openai-capability.adapter';
import type { OpenAiClient, OpenAiCompletionRequest } from '../../src/ai/adapters/openai/openai-client';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import type { GatewayContext } from '../../src/ai/gateway/gateway.types';
import { RuntimeRole } from '../../src/platform/runtime/role';
import type { PlatformLogger } from '../../src/platform/logging/platform-logger.service';

class FakeClock implements AdapterClock {
  nowMs = 1_000;
  now(): number {
    return this.nowMs;
  }
  async sleep(ms: number): Promise<void> {
    this.nowMs += ms;
  }
}

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
} as unknown as PlatformLogger;

function apiContext(): GatewayContext {
  return {
    orgId: '00000000-0000-7000-8000-000000000001',
    correlationId: 'corr-api',
    runtimeRole: RuntimeRole.Api,
  };
}

describe('OpenAI adapter (DHB-46)', () => {
  it('streams interactive CHAT and accounts tokens as integer micros', async () => {
    const streams: boolean[] = [];
    const client: OpenAiClient = {
      complete: async (request: OpenAiCompletionRequest) => {
        streams.push(request.stream);
        return {
          text: 'hello-from-provider',
          tokensIn: 3,
          tokensOut: 5,
          latencyMs: 8,
        };
      },
    };
    const adapter = new OpenAiCapabilityAdapter(
      'CHAT',
      client,
      new ProviderCircuitBreakerRegistry(new FakeClock()),
      logger,
    );
    const request = { capability: 'CHAT' as const, userMessage: 'hello' };
    const policy = new PolicyResolver().resolve(request);
    const outcome = await adapter.invoke({
      ctx: apiContext(),
      policy,
      payload: new PromptAssembler().assemble(request, policy),
      request,
    });

    expect(streams).toEqual([true]);
    expect(outcome.status).toBe('ok');
    expect(outcome.method).toBe('llm');
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.tokensIn).toBe(3);
    expect(outcome.tokensOut).toBe(5);
    expect(outcome.costMicros).toBe(120);
    expect(Number.isInteger(outcome.costMicros)).toBe(true);
    if (outcome.result?.capability !== 'CHAT') {
      throw new Error('expected chat result');
    }
    expect(outcome.result.text).toBe('hello-from-provider');
  });

  it('walks fallback to deterministic and records both attempts', async () => {
    const client: OpenAiClient = {
      complete: async () => {
        throw new AdapterError('unavailable', 'openai down');
      },
    };
    const adapter = new OpenAiCapabilityAdapter(
      'CHAT',
      client,
      new ProviderCircuitBreakerRegistry(new FakeClock()),
      logger,
    );
    const request = { capability: 'CHAT' as const, userMessage: 'hello' };
    const policy = new PolicyResolver().resolve(request);
    const outcome = await adapter.invoke({
      ctx: apiContext(),
      policy,
      payload: new PromptAssembler().assemble(request, policy),
      request,
    });

    expect(outcome.status).toBe('ok');
    expect(outcome.method).toBe('deterministic');
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.attempts[0]?.status).toBe('failed');
    expect(outcome.attempts[1]?.status).toBe('ok');
    if (outcome.result?.capability !== 'CHAT') {
      throw new Error('expected chat result');
    }
    expect(outcome.result.text).toBe('deterministic-fallback');
  });

  it('does not stream batch EXTRACT_CELL', async () => {
    const streams: boolean[] = [];
    const client: OpenAiClient = {
      complete: async (request: OpenAiCompletionRequest) => {
        streams.push(request.stream);
        return { text: '1999', tokensIn: 2, tokensOut: 1, latencyMs: 4 };
      },
    };
    const adapter = new OpenAiCapabilityAdapter(
      'EXTRACT_CELL',
      client,
      new ProviderCircuitBreakerRegistry(new FakeClock()),
      logger,
    );
    const request = {
      capability: 'EXTRACT_CELL' as const,
      columnKey: 'year',
      documentContent: 'published 1999',
    };
    const policy = new PolicyResolver().resolve(request);
    const outcome = await adapter.invoke({
      ctx: {
        orgId: '00000000-0000-7000-8000-000000000001',
        correlationId: 'corr-worker',
        runtimeRole: RuntimeRole.Worker,
      },
      policy,
      payload: new PromptAssembler().assemble(request, policy),
      request,
    });

    expect(streams).toEqual([false]);
    expect(outcome.status).toBe('ok');
    if (outcome.result?.capability !== 'EXTRACT_CELL') {
      throw new Error('expected extract result');
    }
    expect(outcome.result.value).toBe('1999');
  });
});
