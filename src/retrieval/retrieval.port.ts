import type { RetrievalArm } from '../l0/ports';
import type { RuntimeRole } from '../platform/runtime/role';

export const RETRIEVAL_SERVICE = Symbol('RETRIEVAL_SERVICE');

export type QualityAnnotation = 'body_grounded' | 'metadata_only';
export type RetrievalFallback = RetrievalArm | 'rerank';

export interface RetrievalInput {
  readonly orgId: string;
  /** From the PATH. Never from the request body. */
  readonly projectId: string;
  readonly query: string;
  readonly k: number;
  readonly correlationId: string;
  readonly runtimeRole: RuntimeRole;
  readonly efSearch?: number;
  readonly includeUnresolved?: boolean;
}

export interface RetrievalCandidate {
  readonly chunkId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly text: string;
  readonly arm: RetrievalArm;
  readonly vectorScore: number | null;
  readonly ftsScore: number | null;
}

export interface RankedCandidate {
  readonly chunkId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly text: string;
  readonly rrfScore: number;
  readonly rerankScore: number;
  readonly vectorScore: number | null;
  readonly ftsScore: number | null;
}

export interface SearchCandidate extends RankedCandidate {
  readonly sourceId: string;
  readonly evidenceRefs: readonly string[];
  readonly qualityAnnotation: QualityAnnotation;
}

export interface RetrievalStageScores {
  readonly vector: number | null;
  readonly fts: number | null;
  readonly rrf: number;
  readonly rerank: number;
}

export interface RetrievalTraceRef {
  readonly id: string;
  readonly fingerprint: string;
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
 * `hits` is after RRF → rerank → authz re-check → evidence map → quality → top-k.
 */
export interface RetrievalResult {
  readonly understoodQuery: string;
  readonly vectorHits: readonly RetrievalCandidate[];
  readonly ftsHits: readonly RetrievalCandidate[];
  readonly hits: readonly SearchCandidate[];
  readonly timings: RetrievalStageTimings;
  readonly efSearch: number;
  readonly limit: number;
  readonly rerankMethod: 'llm' | 'deterministic';
  readonly rerankExecutionId: string | null;
  readonly filteredRecallShortfall: number;
  readonly fallbacksUsed: readonly RetrievalFallback[];
  readonly latencyMs: number;
  readonly trace: RetrievalTraceRef;
}

export interface IRetrievalService {
  retrieve(input: RetrievalInput): Promise<RetrievalResult>;
}
