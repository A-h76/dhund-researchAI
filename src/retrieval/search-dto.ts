import { pickDto } from '../platform/persistence/pick-dto';
import type {
  RetrievalFallback,
  RetrievalResult,
  RetrievalStageScores,
  SearchCandidate,
} from './retrieval.port';

export const RETRIEVAL_STAGE_SCORE_KEYS = ['vector', 'fts', 'rrf', 'rerank'] as const;
export const RETRIEVAL_CANDIDATE_DTO_KEYS = [
  'chunkId',
  'sourceId',
  'documentId',
  'score',
  'stageScores',
  'evidenceRefs',
  'qualityAnnotation',
] as const;
export const RETRIEVAL_STATS_DTO_KEYS = [
  'latencyMs',
  'filteredRecallShortfall',
  'fallbacksUsed',
] as const;
export const RETRIEVAL_TRACE_REF_DTO_KEYS = ['id', 'fingerprint'] as const;
export const RETRIEVAL_SEARCH_DTO_KEYS = ['candidates', 'stats', 'trace'] as const;

export interface RetrievalCandidateDto {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly documentId: string;
  readonly score: number;
  readonly stageScores: RetrievalStageScores;
  readonly evidenceRefs: readonly string[];
  readonly qualityAnnotation: SearchCandidate['qualityAnnotation'];
}

export interface RetrievalStatsDto {
  readonly latencyMs: number;
  readonly filteredRecallShortfall: number;
  readonly fallbacksUsed: readonly RetrievalFallback[];
}

export interface RetrievalTraceRefDto {
  readonly id: string;
  readonly fingerprint: string;
}

export interface RetrievalSearchResponse {
  readonly candidates: readonly RetrievalCandidateDto[];
  readonly stats: RetrievalStatsDto;
  readonly trace: RetrievalTraceRefDto;
}

export function toSearchResponse(result: RetrievalResult): RetrievalSearchResponse {
  const candidates = result.hits.map((hit) =>
    pickDto(
      {
        chunkId: hit.chunkId,
        sourceId: hit.sourceId,
        documentId: hit.documentId,
        score: hit.rerankScore,
        stageScores: pickDto(
          {
            vector: hit.vectorScore,
            fts: hit.ftsScore,
            rrf: hit.rrfScore,
            rerank: hit.rerankScore,
          },
          RETRIEVAL_STAGE_SCORE_KEYS,
        ),
        evidenceRefs: hit.evidenceRefs,
        qualityAnnotation: hit.qualityAnnotation,
      },
      RETRIEVAL_CANDIDATE_DTO_KEYS,
    ),
  );
  return pickDto(
    {
      candidates,
      stats: pickDto(
        {
          latencyMs: result.latencyMs,
          filteredRecallShortfall: result.filteredRecallShortfall,
          fallbacksUsed: result.fallbacksUsed,
        },
        RETRIEVAL_STATS_DTO_KEYS,
      ),
      trace: pickDto(
        {
          id: result.trace.id,
          fingerprint: result.trace.fingerprint,
        },
        RETRIEVAL_TRACE_REF_DTO_KEYS,
      ),
    },
    RETRIEVAL_SEARCH_DTO_KEYS,
  );
}
