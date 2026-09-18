export type AiExecutionLedgerStatus = 'ok' | 'failed';

export type AiExecutionLedgerMethod = 'llm' | 'deterministic';

export interface AiExecutionAttemptLedgerRecord {
  readonly id: string;
  readonly attemptNo: number;
  readonly provider: string;
  readonly model: string;
  readonly status: AiExecutionLedgerStatus;
  readonly error?: string;
  readonly latencyMs: number;
  readonly costMicros: number;
}

export interface AiExecutionLedgerRecord {
  readonly id: string;
  readonly orgId: string;
  readonly projectId?: string;
  readonly researchRunId?: string;
  /** RetrievalTrace that grounded this CHAT turn (DHB-62). */
  readonly retrievalTraceId?: string;
  readonly capability: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputFingerprint: string;
  readonly status: AiExecutionLedgerStatus;
  readonly method: AiExecutionLedgerMethod;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMicros: number;
  readonly latencyMs: number;
  readonly correlationId: string;
  readonly attempts: readonly AiExecutionAttemptLedgerRecord[];
}

export interface AiExecutionLedgerPort {
  record(input: AiExecutionLedgerRecord): Promise<void>;
}
