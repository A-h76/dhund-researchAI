import type { RuntimeRole } from '../platform/runtime/role';

export const QUERY_RERANK = Symbol('QUERY_RERANK');

export interface RerankCandidate {
  readonly chunkId: string;
  readonly text: string;
}

export interface QueryRerankInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly query: string;
  readonly candidates: readonly RerankCandidate[];
  readonly correlationId: string;
  readonly runtimeRole: RuntimeRole;
}

export interface QueryRerankResult {
  readonly scores: readonly number[];
  readonly method: 'llm' | 'deterministic';
  readonly aiExecutionId: string;
}

/**
 * Chat-time rerank. Implementation lives in AI and must call Gateway RERANK
 * on the interactive lane — retrieval never imports a provider SDK or queue.
 */
export interface QueryRerankPort {
  rerank(input: QueryRerankInput): Promise<QueryRerankResult>;
}
