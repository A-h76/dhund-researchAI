import type { CapabilityInvokeResult } from '../gateway/gateway.types';

export type AdapterAttemptStatus = 'ok' | 'failed';

export interface AdapterAttemptOutcome {
  readonly provider: string;
  readonly model: string;
  readonly status: AdapterAttemptStatus;
  readonly error?: string;
  readonly latencyMs: number;
  readonly costMicros: number;
}

export interface AdapterInvokeOutcome {
  readonly status: AdapterAttemptStatus;
  readonly method: 'llm' | 'deterministic';
  readonly result?: CapabilityInvokeResult;
  readonly attempts: readonly AdapterAttemptOutcome[];
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMicros: number;
}
