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
  readonly arm: RetrievalArm;
}

export interface RetrievalStageTimings {
  readonly queryUnderstandingMs: number;
  readonly vectorMs: number;
  readonly ftsMs: number;
}

/**
 * Arm output before RRF (DHB-56). Eligibility is already applied in SQL —
 * these candidates are the fusion input.
 */
export interface RetrievalArmOutput {
  readonly understoodQuery: string;
  readonly vectorHits: readonly RetrievalCandidate[];
  readonly ftsHits: readonly RetrievalCandidate[];
  readonly timings: RetrievalStageTimings;
  readonly efSearch: number;
  readonly limit: number;
}

export interface IRetrievalService {
  retrieve(input: RetrievalInput): Promise<RetrievalArmOutput>;
}
