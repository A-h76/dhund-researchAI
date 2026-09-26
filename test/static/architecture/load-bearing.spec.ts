import { AdapterRegistry } from '../../../src/ai/adapters/adapter-registry';
import type { AdapterInvokeInput, CapabilityAdapter } from '../../../src/ai/adapters/adapter.port';
import { StubChatAdapter } from '../../../src/ai/adapters/stub/stub-adapters';
import { NoopDataBoundary } from '../../../src/ai/boundary/noop-data-boundary';
import { GatewayService } from '../../../src/ai/gateway/gateway.service';
import type { GatewayContext, GatewayRequest } from '../../../src/ai/gateway/gateway.types';
import { PolicyResolver } from '../../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../../src/ai/policy/prompt-assembler';
import type {
  AiExecutionLedgerPort,
  AiExecutionLedgerRecord,
} from '../../../src/l0/ports/ai-execution-ledger.port';
import { PlatformLogger } from '../../../src/platform/logging/platform-logger.service';
import { RuntimeRole } from '../../../src/platform/runtime/role';
import {
  executionLedgerGap,
  findAdapterBypassViolations,
  findSdkImportViolations,
  srcFiles,
} from './conformance';

class CountingAdapter implements CapabilityAdapter {
  invocations = 0;

  constructor(private readonly inner: CapabilityAdapter) {}

  get capability(): CapabilityAdapter['capability'] {
    return this.inner.capability;
  }

  async invoke(input: AdapterInvokeInput) {
    this.invocations += 1;
    return this.inner.invoke(input);
  }
}

class InMemoryLedger implements AiExecutionLedgerPort {
  readonly records: AiExecutionLedgerRecord[] = [];

  async record(input: AiExecutionLedgerRecord): Promise<void> {
    this.records.push(input);
  }
}

describe('§11a.2a test 1 provider SDK import', () => {
  it('has no provider SDK import outside ai/adapters', () => {
    expect(findSdkImportViolations(srcFiles())).toEqual([]);
  });

  it('fails when a provider SDK import is introduced outside adapters', () => {
    expect(
      findSdkImportViolations([
        { path: 'src/retrieval/bypass.ts', content: "import OpenAI from 'openai';" },
      ]),
    ).toEqual(['src/retrieval/bypass.ts']);
  });
});

describe('§11a.2a test 4 ai_executions row', () => {
  it('has no adapter invoke outside the gateway ledger write', () => {
    expect(findAdapterBypassViolations(srcFiles())).toEqual([]);
  });

  it('fails when an adapter is invoked without the gateway', () => {
    expect(
      findAdapterBypassViolations([
        {
          path: 'src/retrieval/bypass.ts',
          content: 'const outcome = await adapter.invoke(input);',
        },
      ]),
    ).toEqual(['src/retrieval/bypass.ts: adapter invoke outside the AI gateway']);
  });

  it('writes one ai_executions row for each adapter invocation', async () => {
    const counting = new CountingAdapter(new StubChatAdapter());
    const ledger = new InMemoryLedger();
    const logger = {
      info: () => undefined,
      error: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
    } as unknown as PlatformLogger;
    const gateway = new GatewayService(
      new NoopDataBoundary(),
      ledger,
      new PolicyResolver(),
      new PromptAssembler(),
      AdapterRegistry.forAdapters([counting]),
      logger,
    );
    const ctx: GatewayContext = {
      orgId: '00000000-0000-7000-8000-000000000001',
      correlationId: 'corr-load-bearing',
      runtimeRole: RuntimeRole.Api,
    };
    const request: GatewayRequest = { capability: 'CHAT', userMessage: 'hello' };

    const result = await gateway.execute(ctx, request);

    expect(result.aiExecutionId).toEqual(ledger.records[0]?.id);
    expect(executionLedgerGap(counting.invocations, ledger.records.length)).toBeNull();
  });

  it('fails when an invocation has no ai_executions row', () => {
    expect(executionLedgerGap(1, 0)).toBe(
      'adapter invocations (1) do not match ai_executions rows (0)',
    );
  });
});
