import type { EmbedInputType } from '../policy/embed-policy.constants';
import type { RuntimeRole } from '../../platform/runtime/role';

export interface GatewaySecretsContext {
  readonly connectorCredential?: string;
  readonly refreshToken?: string;
  readonly apiKey?: string;
}

export interface GatewayContext {
  readonly orgId: string;
  readonly projectId?: string;
  readonly researchRunId?: string;
  readonly correlationId: string;
  readonly runtimeRole: RuntimeRole;
  /** Caller-declared clinical/patient work. Not inferred from document text. */
  readonly declaredClinical?: boolean;
  readonly secretsContext?: GatewaySecretsContext;
}

export type GatewayRequest =
  | {
      readonly capability: 'CHAT';
      readonly userMessage: string;
      readonly documentContent?: string;
      readonly systemInstructions?: string;
      /** Folded into input_fingerprint so chat provenance includes retrieval (DHB-62). */
      readonly retrievalFingerprint?: string;
      readonly retrievalTraceId?: string;
    }
  | {
      readonly capability: 'EMBED';
      readonly texts: readonly string[];
      readonly inputType: EmbedInputType;
      readonly expectedDimensions?: readonly number[];
    }
  | {
      readonly capability: 'RERANK';
      readonly query: string;
      readonly candidates: readonly string[];
      readonly documentContent?: string;
    }
  | {
      readonly capability: 'AUTOCOMPLETE';
      readonly prefix: string;
      readonly documentContent?: string;
    }
  | {
      readonly capability: 'EXTRACT_CELL';
      readonly columnKey: string;
      readonly documentContent: string;
    }
  | {
      readonly capability: 'SCREENING';
      readonly criteria: string;
      readonly documentContent: string;
    }
  | {
      readonly capability: 'STANCE';
      readonly claim: string;
      readonly documentContent: string;
    }
  | {
      readonly capability: 'SYNTHESIS';
      readonly evidenceSummaries: readonly string[];
      readonly documentContent?: string;
    }
  | {
      readonly capability: 'OCR';
      readonly objectKey: string;
    };

export interface AssembledProviderPayload {
  readonly capability: GatewayRequest['capability'];
  readonly promptVersion: string;
  readonly systemPrompt: string;
  readonly userPayload: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface GatewayExecutionMetrics {
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMicros: number;
}

export interface GatewayResultProvenance {
  readonly aiExecutionId: string;
  readonly method: 'llm' | 'deterministic';
}

export interface OcrBlock {
  readonly text: string;
  readonly confidence: number;
  readonly bbox?: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  } | null;
}

export interface OcrPage {
  readonly page: number;
  readonly confidence: number;
  readonly blocks: readonly OcrBlock[];
}

export type CapabilityInvokeResult =
  | {
      readonly capability: 'CHAT';
      readonly text: string;
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly capability: 'EMBED';
      readonly vectors: readonly (readonly number[])[];
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
      readonly inputType: EmbedInputType;
    }
  | {
      readonly capability: 'RERANK';
      readonly scores: readonly number[];
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly capability: 'AUTOCOMPLETE';
      readonly completion: string;
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly capability: 'EXTRACT_CELL';
      readonly value: string;
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly capability: 'SCREENING';
      readonly decision: 'include' | 'exclude' | 'uncertain';
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly capability: 'STANCE';
      readonly stance: 'support' | 'oppose' | 'neutral';
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly capability: 'SYNTHESIS';
      readonly text: string;
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly capability: 'OCR';
      readonly text: string;
      readonly pages: readonly OcrPage[];
      readonly meanConfidence: number;
      readonly metrics: GatewayExecutionMetrics;
      readonly inputFingerprint: string;
      readonly promptVersion: string;
      readonly provider: string;
      readonly model: string;
    };

export type GatewayResult = CapabilityInvokeResult & GatewayResultProvenance;
