import { EMBED_DIMENSION } from '../../policy/embed-policy.constants';
import type {
  AdapterDispatchRecord,
  AdapterInvokeInput,
  CapabilityAdapter,
} from '../adapter.port';
import type { AdapterInvokeOutcome } from '../adapter-outcome';
import type { CapabilityInvokeResult, GatewayExecutionMetrics } from '../../gateway/gateway.types';
import { computeInputFingerprint } from '../../gateway/input-fingerprint';

const STUB_METRICS: GatewayExecutionMetrics = Object.freeze({
  latencyMs: 1,
  tokensIn: 1,
  tokensOut: 1,
  costMicros: 0,
});

function successfulOutcome(
  input: AdapterInvokeInput,
  result: CapabilityInvokeResult,
): AdapterInvokeOutcome {
  return {
    status: 'ok',
    method: 'llm',
    result,
    attempts: [
      {
        provider: input.policy.provider,
        model: input.policy.modelId,
        status: 'ok',
        latencyMs: result.metrics.latencyMs,
        costMicros: result.metrics.costMicros,
      },
    ],
    tokensIn: result.metrics.tokensIn,
    tokensOut: result.metrics.tokensOut,
    costMicros: result.metrics.costMicros,
  };
}

abstract class StubCapabilityAdapter implements CapabilityAdapter {
  abstract readonly capability: CapabilityAdapter['capability'];
  private readonly dispatches: AdapterDispatchRecord[] = [];

  async invoke(input: AdapterInvokeInput): Promise<AdapterInvokeOutcome> {
    this.dispatches.push({
      capability: this.capability,
      provider: input.policy.provider,
      model: input.policy.modelId,
    });
    const result = await this.buildResult(input);
    return successfulOutcome(input, result);
  }

  getDispatches(): readonly AdapterDispatchRecord[] {
    return [...this.dispatches];
  }

  resetDispatches(): void {
    this.dispatches.length = 0;
  }

  protected baseFields(input: AdapterInvokeInput) {
    return {
      inputFingerprint: computeInputFingerprint(input.request),
      promptVersion: input.policy.promptVersion,
      provider: input.policy.provider,
      model: input.policy.modelId,
      metrics: STUB_METRICS,
    };
  }

  protected abstract buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult>;
}

export class StubChatAdapter extends StubCapabilityAdapter {
  readonly capability = 'CHAT' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    return {
      capability: 'CHAT',
      text: 'stub-chat-response',
      ...this.baseFields(input),
    };
  }
}

export class StubEmbedAdapter extends StubCapabilityAdapter {
  readonly capability = 'EMBED' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    if (input.request.capability !== 'EMBED') {
      throw new Error('StubEmbedAdapter received non-EMBED request');
    }

    return {
      capability: 'EMBED',
      vectors: input.request.texts.map(() =>
        Array.from({ length: EMBED_DIMENSION }, () => 0.001),
      ),
      inputType: input.request.inputType,
      ...this.baseFields(input),
    };
  }
}

export class StubRerankAdapter extends StubCapabilityAdapter {
  readonly capability = 'RERANK' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    if (input.request.capability !== 'RERANK') {
      throw new Error('StubRerankAdapter received non-RERANK request');
    }

    return {
      capability: 'RERANK',
      scores: input.request.candidates.map((_candidate: string, index: number) => 1 - index * 0.1),
      ...this.baseFields(input),
    };
  }
}

export class StubAutocompleteAdapter extends StubCapabilityAdapter {
  readonly capability = 'AUTOCOMPLETE' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    if (input.request.capability !== 'AUTOCOMPLETE') {
      throw new Error('StubAutocompleteAdapter received non-AUTOCOMPLETE request');
    }

    return {
      capability: 'AUTOCOMPLETE',
      completion: `${input.request.prefix}-completed`,
      ...this.baseFields(input),
    };
  }
}

export class StubExtractCellAdapter extends StubCapabilityAdapter {
  readonly capability = 'EXTRACT_CELL' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    return {
      capability: 'EXTRACT_CELL',
      value: 'stub-cell-value',
      ...this.baseFields(input),
    };
  }
}

export class StubScreeningAdapter extends StubCapabilityAdapter {
  readonly capability = 'SCREENING' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    return {
      capability: 'SCREENING',
      decision: 'include',
      ...this.baseFields(input),
    };
  }
}

export class StubStanceAdapter extends StubCapabilityAdapter {
  readonly capability = 'STANCE' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    return {
      capability: 'STANCE',
      stance: 'neutral',
      ...this.baseFields(input),
    };
  }
}

export class StubSynthesisAdapter extends StubCapabilityAdapter {
  readonly capability = 'SYNTHESIS' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    return {
      capability: 'SYNTHESIS',
      text: 'stub-synthesis',
      ...this.baseFields(input),
    };
  }
}

export class StubOcrAdapter extends StubCapabilityAdapter {
  readonly capability = 'OCR' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    return {
      capability: 'OCR',
      text: 'stub-ocr-text',
      ...this.baseFields(input),
    };
  }
}

export const STUB_ADAPTERS: readonly CapabilityAdapter[] = [
  new StubChatAdapter(),
  new StubEmbedAdapter(),
  new StubRerankAdapter(),
  new StubAutocompleteAdapter(),
  new StubExtractCellAdapter(),
  new StubScreeningAdapter(),
  new StubStanceAdapter(),
  new StubSynthesisAdapter(),
  new StubOcrAdapter(),
];

export type StubAdapterInstance = InstanceType<
  | typeof StubChatAdapter
  | typeof StubEmbedAdapter
  | typeof StubRerankAdapter
  | typeof StubAutocompleteAdapter
  | typeof StubExtractCellAdapter
  | typeof StubScreeningAdapter
  | typeof StubStanceAdapter
  | typeof StubSynthesisAdapter
  | typeof StubOcrAdapter
>;
