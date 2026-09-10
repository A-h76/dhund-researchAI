import type { RetrievalArm } from '../l0/ports';
import type { RuntimeRole } from '../platform/runtime/role';

export const RETRIEVAL_SERVICE = Symbol('RETRIEVAL_SERVICE');

export interface RetrievalInput {
  readonly orgId: string;
  /** From the PATH. Never from the request body. */
  readonly projectId: string;
  readonly query: string;
  readonly k: number;
  readonly correlationId: string;
  readonly runtimeRole: RuntimeRole;
  readonly efSearch?: number;
}

export interface RetrievalCandidate {
  readonly chunkId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly text: string;
  readonly arm: RetrievalArm;
}

export interface RankedCandidate {
  readonly chunkId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly text: string;
  readonly rrfScore: number;
  readonly rerankScore: number;
}

export interface RetrievalStageTimings {
  readonly queryUnderstandingMs: number;
  readonly vectorMs: number;
  readonly ftsMs: number;
  readonly rrfMs: number;
  readonly rerankMs: number;
}

/**
 * Arm hits are the fusion input. Eligibility already ran in SQL (DHB-55).
 * `hits` is after RRF → rerank → authz re-check → top-k.
 */
export interface RetrievalResult {
  readonly understoodQuery: string;
  readonly vectorHits: readonly RetrievalCandidate[];
  readonly ftsHits: readonly RetrievalCandidate[];
  readonly hits: readonly RankedCandidate[];
  readonly timings: RetrievalStageTimings;
  readonly efSearch: number;
  readonly limit: number;
  readonly rerankMethod: 'llm' | 'deterministic';
  readonly rerankExecutionId: string | null;
  readonly filteredRecallShortfall: number;
}

export interface IRetrievalService {
  retrieve(input: RetrievalInput): Promise<RetrievalResult>;
}
