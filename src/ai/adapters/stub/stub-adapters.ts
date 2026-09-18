import { EMBED_DIMENSION } from '../../policy/embed-policy.constants';
import type { ObjectStorageService } from '../../../l0/ports/object-storage.port';
import type {
  AdapterDispatchRecord,
  AdapterInvokeInput,
  CapabilityAdapter,
} from '../adapter.port';
import type { AdapterInvokeOutcome } from '../adapter-outcome';
import type { CapabilityInvokeResult, GatewayExecutionMetrics } from '../../gateway/gateway.types';
import { computeInputFingerprint } from '../../gateway/input-fingerprint';
import { loadOcrObject } from '../ocr/ocr-storage';

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
    const text = 'stub-chat-response';
    if (input.onToken !== undefined) {
      for (const token of text.match(/\S+|\s+/g) ?? [text]) {
        try {
          input.onToken(token);
        } catch {
          // Sink failures must not cancel generation.
        }
      }
    }
    return {
      capability: 'CHAT',
      text,
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

  constructor(private readonly storage: ObjectStorageService) {
    super();
  }

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    if (input.request.capability !== 'OCR') {
      throw new Error('StubOcrAdapter received non-OCR request');
    }

    const bytes = await loadOcrObject(this.storage, input.request.objectKey);
    const text = bytes.byteLength > 0 ? 'stub-ocr-text' : '';

    return {
      capability: 'OCR',
      text,
      meanConfidence: 0.95,
      pages: [
        {
          page: 1,
          confidence: 0.95,
          blocks: [{ text, confidence: 0.95 }],
        },
      ],
      ...this.baseFields(input),
    };
  }
}

export class StubEvidenceExtractAdapter extends StubCapabilityAdapter {
  readonly capability = 'EVIDENCE_EXTRACT' as const;

  protected async buildResult(input: AdapterInvokeInput): Promise<CapabilityInvokeResult> {
    if (input.request.capability !== 'EVIDENCE_EXTRACT') {
      throw new Error('StubEvidenceExtractAdapter received non-EVIDENCE_EXTRACT request');
    }

    const locator = input.request.locatorCatalog[0];
    const snippet = input.request.documentContent.trim().slice(0, 120);
    const candidates =
      locator === undefined || snippet.length === 0
        ? []
        : [
            {
              text: snippet,
              locator: {
                documentVersionId: locator.documentVersionId,
                blockId: locator.blockId,
                page: locator.page,
              },
              type: 'body_grounded' as const,
              ...(locator.chunkId !== undefined ? { chunkId: locator.chunkId } : {}),
            },
          ];

    return {
      capability: 'EVIDENCE_EXTRACT',
      candidates,
      ...this.baseFields(input),
    };
  }
}

export function createStubAdapters(storage: ObjectStorageService): readonly CapabilityAdapter[] {
  return [
    new StubChatAdapter(),
    new StubEmbedAdapter(),
    new StubRerankAdapter(),
    new StubAutocompleteAdapter(),
    new StubExtractCellAdapter(),
    new StubScreeningAdapter(),
    new StubStanceAdapter(),
    new StubSynthesisAdapter(),
    new StubOcrAdapter(storage),
    new StubEvidenceExtractAdapter(),
  ];
}

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
  | typeof StubEvidenceExtractAdapter
>;
