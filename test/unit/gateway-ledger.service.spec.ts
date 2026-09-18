import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterInvokeOutcome } from '../../src/ai/adapters/adapter-outcome';
import type {
  AdapterInvokeInput,
  CapabilityAdapter,
} from '../../src/ai/adapters/adapter.port';
import { AdapterRegistry } from '../../src/ai/adapters/adapter-registry';
import { NoopDataBoundary } from '../../src/ai/boundary/noop-data-boundary';
import { GatewayService } from '../../src/ai/gateway/gateway.service';
import type { GatewayContext, GatewayRequest } from '../../src/ai/gateway/gateway.types';
import { GatewayExecutionFailedError } from '../../src/ai/gateway/gateway-execution.errors';
import { computeInputFingerprint } from '../../src/ai/gateway/input-fingerprint';
import type {
  AiExecutionLedgerPort,
  AiExecutionLedgerRecord,
} from '../../src/l0/ports/ai-execution-ledger.port';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';
import { MoneyMicrosError } from '../../src/platform/money/micros';
import { RuntimeRole } from '../../src/platform/runtime/role';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';
import { stubAdaptersWithOcrObject } from '../fixtures/stub-ai-adapters';

class TrackingLedger implements AiExecutionLedgerPort {
  readonly records: AiExecutionLedgerRecord[] = [];
  private releaseRecord: (() => void) | undefined;
  private recordGate: Promise<void> | undefined;

  armRecordGate(): void {
    this.recordGate = new Promise<void>((resolve) => {
      this.releaseRecord = resolve;
    });
  }

  async record(input: AiExecutionLedgerRecord): Promise<void> {
    this.records.push(structuredClone(input));
    if (this.recordGate !== undefined) {
      await this.recordGate;
    }
  }

  releasePendingRecord(): void {
    this.releaseRecord?.();
  }

  reset(): void {
    this.records.length = 0;
    this.releaseRecord = undefined;
    this.recordGate = undefined;
  }
}

class FailingChatAdapter implements CapabilityAdapter {
  readonly capability = 'CHAT' as const;

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    void input;
    return {
      status: 'failed',
      method: 'llm',
      attempts: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          status: 'failed',
          error: 'provider unavailable',
          latencyMs: 5,
          costMicros: 0,
        },
      ],
      tokensIn: 0,
      tokensOut: 0,
      costMicros: 0,
    };
  }
}

class MultiAttemptChatAdapter implements CapabilityAdapter {
  readonly capability = 'CHAT' as const;

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    return {
      status: 'ok',
      method: 'llm',
      result: {
        capability: 'CHAT',
        text: 'recovered-response',
        inputFingerprint: computeInputFingerprint(input.request),
        promptVersion: input.policy.promptVersion,
        provider: input.policy.provider,
        model: input.policy.modelId,
        metrics: { latencyMs: 3, tokensIn: 2, tokensOut: 4, costMicros: 1500 },
      },
      attempts: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          status: 'failed',
          error: 'timeout',
          latencyMs: 100,
          costMicros: 500,
        },
        {
          provider: input.policy.provider,
          model: input.policy.modelId,
          status: 'ok',
          latencyMs: 3,
          costMicros: 1000,
        },
      ],
      tokensIn: 2,
      tokensOut: 4,
      costMicros: 1500,
    };
  }
}

class DeterministicChatAdapter implements CapabilityAdapter {
  readonly capability = 'CHAT' as const;

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    return {
      status: 'ok',
      method: 'deterministic',
      result: {
        capability: 'CHAT',
        text: 'deterministic-fallback',
        inputFingerprint: computeInputFingerprint(input.request),
        promptVersion: input.policy.promptVersion,
        provider: input.policy.provider,
        model: input.policy.modelId,
        metrics: { latencyMs: 1, tokensIn: 0, tokensOut: 0, costMicros: 0 },
      },
      attempts: [
        {
          provider: input.policy.provider,
          model: input.policy.modelId,
          status: 'ok',
          latencyMs: 1,
          costMicros: 0,
        },
      ],
      tokensIn: 0,
      tokensOut: 0,
      costMicros: 0,
    };
  }
}

class FloatCostChatAdapter implements CapabilityAdapter {
  readonly capability = 'CHAT' as const;

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    return {
      status: 'ok',
      method: 'llm',
      result: {
        capability: 'CHAT',
        text: 'float-cost',
        inputFingerprint: computeInputFingerprint(input.request),
        promptVersion: input.policy.promptVersion,
        provider: input.policy.provider,
        model: input.policy.modelId,
        metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 1.5 },
      },
      attempts: [
        {
          provider: input.policy.provider,
          model: input.policy.modelId,
          status: 'ok',
          latencyMs: 1,
          costMicros: 1.5,
        },
      ],
      tokensIn: 1,
      tokensOut: 1,
      costMicros: 1.5,
    };
  }
}

class BypassProbeAdapter implements CapabilityAdapter {
  readonly capability = 'CHAT' as const;
  readonly events: string[] = [];

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    void input;
    this.events.push('adapter.invoke.returned');
    return {
      status: 'ok',
      method: 'llm',
      result: {
        capability: 'CHAT',
        text: 'probe',
        inputFingerprint: 'fp',
        promptVersion: 'v1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 0 },
      },
      attempts: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          status: 'ok',
          latencyMs: 1,
          costMicros: 0,
        },
      ],
      tokensIn: 1,
      tokensOut: 1,
      costMicros: 0,
    };
  }

  markLedgerRecorded(): void {
    this.events.push('ledger.recorded');
  }
}

function apiContext(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    orgId: '00000000-0000-7000-8000-000000000001',
    correlationId: 'corr-api',
    runtimeRole: RuntimeRole.Api,
    ...overrides,
  };
}

function createGateway(
  options: {
    ledger?: TrackingLedger;
    adapters?: readonly CapabilityAdapter[];
    logger?: PlatformLogger;
  } = {},
): {
  gateway: GatewayService;
  ledger: TrackingLedger;
  logger: PlatformLogger;
} {
  const ledger = options.ledger ?? new TrackingLedger();
  const logger =
    options.logger ??
    ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger);

  const gateway = new GatewayService(
    new NoopDataBoundary(),
    ledger,
    new PolicyResolver(),
    new PromptAssembler(),
    options.adapters !== undefined
      ? AdapterRegistry.forAdapters(options.adapters)
      : AdapterRegistry.forAdapters(stubAdaptersWithOcrObject().adapters),
    logger,
  );

  return { gateway, ledger, logger };
}

describe('GatewayService ledger (DHB-45)', () => {
  it('persists exactly one execution for a successful Gateway call', async () => {
    const { gateway, ledger } = createGateway();
    const request: GatewayRequest = { capability: 'CHAT', userMessage: 'hello' };

    await gateway.execute(apiContext(), request);

    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]?.status).toBe('ok');
    expect(ledger.records[0]?.capability).toBe('CHAT');
  });

  it('persists correct attempt rows for a successful call', async () => {
    const { gateway, ledger } = createGateway();
    await gateway.execute(apiContext(), { capability: 'CHAT', userMessage: 'hello' });

    const record = ledger.records[0];
    expect(record?.attempts).toHaveLength(1);
    expect(record?.attempts[0]?.attemptNo).toBe(1);
    expect(record?.attempts[0]?.status).toBe('ok');
  });

  it('commits the ledger before execute returns', async () => {
    const ledger = new TrackingLedger();
    ledger.armRecordGate();
    const { gateway } = createGateway({ ledger });
    let resolved = false;

    const executePromise = gateway
      .execute(apiContext(), { capability: 'CHAT', userMessage: 'hello' })
      .then((result) => {
        resolved = true;
        return result;
      });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(ledger.records).toHaveLength(1);
    expect(resolved).toBe(false);

    ledger.releasePendingRecord();
    const result = await executePromise;
    expect(resolved).toBe(true);
    expect(result.aiExecutionId).toBe(ledger.records[0]?.id);
  });

  it('persists a failed execution when the adapter fails', async () => {
    const { gateway, ledger } = createGateway({ adapters: [new FailingChatAdapter()] });

    await expect(
      gateway.execute(apiContext(), { capability: 'CHAT', userMessage: 'hello' }),
    ).rejects.toBeInstanceOf(GatewayExecutionFailedError);

    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]?.status).toBe('failed');
    expect(ledger.records[0]?.attempts[0]?.status).toBe('failed');
  });

  it('does not return fake success when the adapter fails', async () => {
    const { gateway } = createGateway({ adapters: [new FailingChatAdapter()] });

    await expect(
      gateway.execute(apiContext(), { capability: 'CHAT', userMessage: 'hello' }),
    ).rejects.toMatchObject({
      aiExecutionId: expect.any(String),
    });
  });

  it('records multiple attempts from a test double', async () => {
    const { gateway, ledger } = createGateway({ adapters: [new MultiAttemptChatAdapter()] });

    const result = await gateway.execute(apiContext(), {
      capability: 'CHAT',
      userMessage: 'hello',
    });

    expect(result.capability).toBe('CHAT');
    if (result.capability !== 'CHAT') {
      throw new Error('expected chat result');
    }
    expect(result.text).toBe('recovered-response');
    expect(ledger.records[0]?.attempts).toHaveLength(2);
    expect(ledger.records[0]?.costMicros).toBe(1500);
  });

  it('labels deterministic outcomes with method deterministic', async () => {
    const { gateway, ledger } = createGateway({ adapters: [new DeterministicChatAdapter()] });

    const result = await gateway.execute(apiContext(), {
      capability: 'CHAT',
      userMessage: 'hello',
    });

    expect(result.method).toBe('deterministic');
    expect(ledger.records[0]?.method).toBe('deterministic');
  });

  it('enforces integer micros on execution cost', async () => {
    const { gateway, ledger } = createGateway({ adapters: [new MultiAttemptChatAdapter()] });
    await gateway.execute(apiContext(), { capability: 'CHAT', userMessage: 'hello' });
    expect(Number.isInteger(ledger.records[0]?.costMicros)).toBe(true);
  });

  it('rejects float cost values from adapters', async () => {
    const { gateway } = createGateway({ adapters: [new FloatCostChatAdapter()] });

    await expect(
      gateway.execute(apiContext(), { capability: 'CHAT', userMessage: 'hello' }),
    ).rejects.toBeInstanceOf(MoneyMicrosError);
  });

  it('returns aiExecutionId to callers', async () => {
    const { gateway, ledger } = createGateway();
    const result = await gateway.execute(apiContext(), {
      capability: 'CHAT',
      userMessage: 'hello',
    });

    expect(result.aiExecutionId).toBe(ledger.records[0]?.id);
  });

  it('includes aiExecutionId on failed execution errors', async () => {
    const { gateway, ledger } = createGateway({ adapters: [new FailingChatAdapter()] });

    try {
      await gateway.execute(apiContext(), { capability: 'CHAT', userMessage: 'hello' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayExecutionFailedError);
      if (error instanceof GatewayExecutionFailedError) {
        expect(error.aiExecutionId).toBe(ledger.records[0]?.id);
      }
    }
  });

  it('never logs prompt or document content in execution events', async () => {
    const info = jest.fn();
    const logger = { info, error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as unknown as PlatformLogger;
    const { gateway } = createGateway({ logger });
    const secretText = 'super-secret-document-body';

    await gateway.execute(apiContext(), {
      capability: 'CHAT',
      userMessage: 'summarize',
      documentContent: secretText,
    });

    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toContain(secretText);
    expect(serialized).not.toContain('summarize');
    expect(serialized).toMatch(/ai\.execution\.completed/);
  });

  it('fails the no-bypass contract when adapter returns without a ledger record', async () => {
    class NoLedgerGateway extends GatewayService {
      async execute(ctx: GatewayContext, request: GatewayRequest) {
        const adapter = new BypassProbeAdapter();
        const outcome = await adapter.invoke({
          ctx,
          policy: new PolicyResolver().resolve(request),
          payload: new PromptAssembler().assemble(
            request,
            new PolicyResolver().resolve(request),
          ),
          request,
        });
        if (outcome.result === undefined) {
          throw new Error('missing result');
        }
        return {
          ...outcome.result,
          aiExecutionId: 'fake-id',
          method: outcome.method,
        };
      }
    }

    const probe = new BypassProbeAdapter();
    const outcome = await probe.invoke({
      ctx: apiContext(),
      policy: new PolicyResolver().resolve({ capability: 'CHAT', userMessage: 'x' }),
      payload: new PromptAssembler().assemble(
        { capability: 'CHAT', userMessage: 'x' },
        new PolicyResolver().resolve({ capability: 'CHAT', userMessage: 'x' }),
      ),
      request: { capability: 'CHAT', userMessage: 'x' },
    });

    expect(outcome.result).toBeDefined();
    expect(probe.events).toEqual(['adapter.invoke.returned']);
    expect(probe.events).not.toContain('ledger.recorded');

    const bypass = new NoLedgerGateway(
      new NoopDataBoundary(),
      new TrackingLedger(),
      new PolicyResolver(),
      new PromptAssembler(),
      AdapterRegistry.forAdapters([probe]),
      { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as unknown as PlatformLogger,
    );

    const result = await bypass.execute(apiContext(), { capability: 'CHAT', userMessage: 'x' });
    expect(result.aiExecutionId).toBe('fake-id');

    const compliantLedger = new TrackingLedger();
    const compliant = createGateway({
      ledger: compliantLedger,
      adapters: [new BypassProbeAdapter()],
    });
    await compliant.gateway.execute(apiContext(), { capability: 'CHAT', userMessage: 'x' });
    expect(compliantLedger.records).toHaveLength(1);
  });
});

describe('DHB-45 static architecture checks', () => {
  it('keeps Prisma out of src/ai', () => {
    const gatewaySource = readFileSync(
      join(process.cwd(), 'src', 'ai', 'gateway', 'gateway.service.ts'),
      'utf8',
    );
    expect(gatewaySource).not.toMatch(/@prisma\/client/);
    expect(gatewaySource).toMatch(/AI_EXECUTION_LEDGER/);
  });
});
