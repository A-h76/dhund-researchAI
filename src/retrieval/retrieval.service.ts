import { Inject, Injectable } from '@nestjs/common';
import {
  EVIDENCE_LOOKUP,
  HNSW_EF_SEARCH_DEFAULT,
  RETRIEVAL_TRACE,
  RetrievalArmUnavailableError,
  resolveHnswEfSearch,
  type EvidenceLookup,
  type RetrievalArm,
  type RetrievalTraceStore,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids/uuid-v7';
import { RuntimeRole } from '../platform/runtime/role';
import { AnnSearch } from './ann-search';
import { authzRecheck } from './authz-recheck';
import { bm25Scores } from './bm25';
import { RETRIEVAL_EMBED_MODEL_ID, RETRIEVAL_EMBED_MODEL_VERSION } from './embed-identity';
import { mapEvidence } from './evidence-map';
import { LexicalSearch } from './lexical-search';
import { armLimit, RETRIEVAL_OVER_FETCH_FACTOR } from './over-fetch';
import { QUERY_EMBED, type QueryEmbedPort } from './query-embed.port';
import { fingerprintRetrievalQuery } from './query-fingerprint';
import { understandQuery } from './query-understanding';
import { applyQualityFilter } from './quality-filter';
import { QUERY_RERANK, type QueryRerankPort } from './rerank.port';
import { RetrievalMetrics } from './retrieval.metrics';
import type {
  IRetrievalService,
  RankedCandidate,
  RetrievalCandidate,
  RetrievalFallback,
  RetrievalInput,
  RetrievalResult,
  SearchCandidate,
} from './retrieval.port';
import { fuseRrf, ineligibleCountAtFusionBoundary, orderByScores } from './rrf';

const MODULE = 'retrieval';

@Injectable()
export class RetrievalService implements IRetrievalService {
  constructor(
    @Inject(QUERY_EMBED) private readonly queryEmbed: QueryEmbedPort,
    private readonly ann: AnnSearch,
    private readonly lexical: LexicalSearch,
    @Inject(QUERY_RERANK) private readonly queryRerank: QueryRerankPort,
    private readonly metrics: RetrievalMetrics,
    @Inject(EVIDENCE_LOOKUP) private readonly evidenceLookup: EvidenceLookup,
    @Inject(RETRIEVAL_TRACE) private readonly traces: RetrievalTraceStore,
  ) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalResult> {
    const started = Date.now();
    const includeUnresolved = input.includeUnresolved === true;
    const understoodStarted = Date.now();
    const understood = understandQuery(input.query);
    const vectorLiteral = await this.queryEmbed.embedQuery({
      orgId: input.orgId,
      projectId: input.projectId,
      text: understood.text,
      correlationId: input.correlationId,
      runtimeRole: input.runtimeRole,
    });
    const queryUnderstandingMs = Date.now() - understoodStarted;
    const limit = armLimit(input.k);
    const scope = { projectId: input.projectId };
    const fallbacksUsed: RetrievalFallback[] = [];

    const [vectorTimed, ftsTimed] = await Promise.all([
      settleArm('vector', () =>
        timeAsync(() => this.ann.nearest(scope, vectorLiteral, limit, input.efSearch)),
      ),
      settleArm('fts', () => timeAsync(() => this.lexical.search(scope, understood.text, limit))),
    ]);

    const vectorMs = vectorTimed.ok ? vectorTimed.value.latencyMs : vectorTimed.latencyMs;
    const ftsMs = ftsTimed.ok ? ftsTimed.value.latencyMs : ftsTimed.latencyMs;
    this.metrics.recordStageLatency('vector', vectorMs);
    this.metrics.recordStageLatency('fts', ftsMs);

    if (!vectorTimed.ok) {
      fallbacksUsed.push('vector');
    }
    if (!ftsTimed.ok) {
      fallbacksUsed.push('fts');
    }

    const efSearch = vectorTimed.ok
      ? vectorTimed.value.value.efSearch
      : resolveHnswEfSearch(input.efSearch ?? HNSW_EF_SEARCH_DEFAULT);

    if (!vectorTimed.ok && !ftsTimed.ok) {
      const latencyMs = Date.now() - started;
      await this.persistTrace({
        input,
        understoodQuery: understood.text,
        includeUnresolved,
        efSearch,
        limit,
        fallbacksUsed,
        vectorHits: [],
        ftsHits: [],
        hits: [],
        filteredRecallShortfall: 0,
        latencyMs,
      });
      this.metrics.recordCompleted({ latencyMs, fallbacksUsed });
      throw new DomainError(ErrorCode.RetrievalUnavailable, { module: MODULE });
    }

    const vectorHits: RetrievalCandidate[] = vectorTimed.ok
      ? vectorTimed.value.value.hits.map((hit) => toCandidate(hit, 'vector'))
      : [];
    const ftsHits: RetrievalCandidate[] = ftsTimed.ok
      ? ftsTimed.value.value.map((hit) => toCandidate(hit, 'fts'))
      : [];

    const rrfTimed = timeSync(() => {
      const ineligible = ineligibleCountAtFusionBoundary(vectorHits, ftsHits);
      if (ineligible !== 0) {
        throw new Error('ineligible candidate present at fusion boundary');
      }
      return fuseRrf(vectorHits, ftsHits);
    });
    this.metrics.recordStageLatency('rrf', rrfTimed.latencyMs);
    const fused = rrfTimed.value;

    const rerankTimed = await timeAsync(() =>
      this.rerankFused(input, understood.text, fused),
    );
    this.metrics.recordStageLatency('rerank', rerankTimed.latencyMs);
    const rerankMethod = rerankTimed.value.method;
    const rerankExecutionId = rerankTimed.value.aiExecutionId;
    if (input.runtimeRole === RuntimeRole.Api && fused.length > 0 && rerankMethod !== 'llm') {
      fallbacksUsed.push('rerank');
    }

    const surviving = authzRecheck(rerankTimed.value.hits, input.projectId);
    const shortfall = this.metrics.recordFilteredRecall(fused.length, surviving.length);

    const lookup = await this.evidenceLookup.lookup(
      scope,
      surviving.map((hit) => hit.chunkId),
      [...new Set(surviving.map((hit) => hit.documentId))],
    );
    const mapped = mapEvidence(surviving, lookup);
    const filtered = applyQualityFilter(mapped, lookup, { includeUnresolved });
    const hits = filtered.slice(0, input.k);
    const latencyMs = Date.now() - started;

    const trace = await this.persistTrace({
      input,
      understoodQuery: understood.text,
      includeUnresolved,
      efSearch,
      limit,
      fallbacksUsed,
      vectorHits,
      ftsHits,
      hits,
      filteredRecallShortfall: shortfall,
      latencyMs,
    });
    this.metrics.recordCompleted({ latencyMs, fallbacksUsed });

    return {
      understoodQuery: understood.text,
      vectorHits,
      ftsHits,
      hits,
      timings: {
        queryUnderstandingMs,
        vectorMs,
        ftsMs,
        rrfMs: rrfTimed.latencyMs,
        rerankMs: rerankTimed.latencyMs,
      },
      efSearch,
      limit,
      rerankMethod,
      rerankExecutionId,
      filteredRecallShortfall: shortfall,
      fallbacksUsed,
      latencyMs,
      trace,
    };
  }

  private async persistTrace(input: {
    readonly input: RetrievalInput;
    readonly understoodQuery: string;
    readonly includeUnresolved: boolean;
    readonly efSearch: number;
    readonly limit: number;
    readonly fallbacksUsed: readonly RetrievalFallback[];
    readonly vectorHits: readonly RetrievalCandidate[];
    readonly ftsHits: readonly RetrievalCandidate[];
    readonly hits: readonly SearchCandidate[];
    readonly filteredRecallShortfall: number;
    readonly latencyMs: number;
  }): Promise<{ readonly id: string; readonly fingerprint: string }> {
    const queryFingerprint = fingerprintRetrievalQuery({
      query: input.understoodQuery,
      projectId: input.input.projectId,
      k: input.input.k,
      overFetchFactor: RETRIEVAL_OVER_FETCH_FACTOR,
      efSearch: input.efSearch,
      includeUnresolved: input.includeUnresolved,
      embeddingModel: RETRIEVAL_EMBED_MODEL_ID,
      embeddingVersion: RETRIEVAL_EMBED_MODEL_VERSION,
    });
    const id = generateId();
    const stored = await this.traces.persist({
      id,
      projectId: input.input.projectId,
      queryFingerprint,
      embeddingModel: RETRIEVAL_EMBED_MODEL_ID,
      embeddingVersion: RETRIEVAL_EMBED_MODEL_VERSION,
      k: input.input.k,
      overFetchFactor: RETRIEVAL_OVER_FETCH_FACTOR,
      efSearch: input.efSearch,
      fallbacksUsed: input.fallbacksUsed,
      body: {
        queryFingerprint,
        embeddingModel: RETRIEVAL_EMBED_MODEL_ID,
        embeddingVersion: RETRIEVAL_EMBED_MODEL_VERSION,
        k: input.input.k,
        overFetchFactor: RETRIEVAL_OVER_FETCH_FACTOR,
        efSearch: input.efSearch,
        projectId: input.input.projectId,
        includeUnresolved: input.includeUnresolved,
        eligibility: 'sql-join',
        fallbackPath: input.fallbacksUsed,
        orderedCandidateIds: input.hits.map((hit) => hit.chunkId),
        candidateScores: input.hits.map((hit) => ({
          chunkId: hit.chunkId,
          vector: hit.vectorScore,
          fts: hit.ftsScore,
          rrf: hit.rrfScore,
          rerank: hit.rerankScore,
        })),
        vectorHitIds: input.vectorHits.map((hit) => hit.chunkId),
        ftsHitIds: input.ftsHits.map((hit) => hit.chunkId),
        filteredRecallShortfall: input.filteredRecallShortfall,
        latencyMs: input.latencyMs,
        limit: input.limit,
      },
    });
    return { id: stored.id, fingerprint: stored.queryFingerprint };
  }

  private async rerankFused(
    input: RetrievalInput,
    query: string,
    fused: ReturnType<typeof fuseRrf>,
  ): Promise<{
    readonly hits: RankedCandidate[];
    readonly method: 'llm' | 'deterministic';
    readonly aiExecutionId: string | null;
  }> {
    if (fused.length === 0) {
      return { hits: [], method: 'deterministic', aiExecutionId: null };
    }

    const bm25 = () => orderByScores(fused, bm25Scores(query, fused.map((candidate) => candidate.text)));

    if (input.runtimeRole !== RuntimeRole.Api) {
      return { hits: bm25(), method: 'deterministic', aiExecutionId: null };
    }

    try {
      const result = await this.queryRerank.rerank({
        orgId: input.orgId,
        projectId: input.projectId,
        query,
        candidates: fused.map((candidate) => ({
          chunkId: candidate.chunkId,
          text: candidate.text,
        })),
        correlationId: input.correlationId,
        runtimeRole: input.runtimeRole,
      });
      if (result.method === 'llm' && result.scores.length === fused.length) {
        this.metrics.recordRerankLlm();
        return {
          hits: orderByScores(fused, result.scores),
          method: 'llm',
          aiExecutionId: result.aiExecutionId,
        };
      }
      this.metrics.recordRerankFallback();
      return {
        hits: bm25(),
        method: 'deterministic',
        aiExecutionId: result.aiExecutionId,
      };
    } catch {
      this.metrics.recordRerankFallback();
      return { hits: bm25(), method: 'deterministic', aiExecutionId: null };
    }
  }
}

function toCandidate(
  hit: {
    readonly chunkId: string;
    readonly projectId: string;
    readonly documentId: string;
    readonly text?: string;
    readonly vectorScore?: number | null;
    readonly ftsScore?: number | null;
  },
  arm: RetrievalCandidate['arm'],
): RetrievalCandidate {
  return {
    chunkId: hit.chunkId,
    projectId: hit.projectId,
    documentId: hit.documentId,
    text: hit.text ?? '',
    arm,
    vectorScore: arm === 'vector' ? toNullableNumber(hit.vectorScore) : null,
    ftsScore: arm === 'fts' ? toNullableNumber(hit.ftsScore) : null,
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

type SettledArm<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly latencyMs: number };

async function settleArm<T>(
  arm: RetrievalArm,
  work: () => Promise<{ readonly value: T; readonly latencyMs: number }>,
): Promise<SettledArm<{ readonly value: T; readonly latencyMs: number }>> {
  const started = Date.now();
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof RetrievalArmUnavailableError && error.arm === arm) {
      return { ok: false, latencyMs: Date.now() - started };
    }
    throw error;
  }
}

async function timeAsync<T>(
  work: () => Promise<T>,
): Promise<{ readonly value: T; readonly latencyMs: number }> {
  const started = Date.now();
  const value = await work();
  return { value, latencyMs: Date.now() - started };
}

function timeSync<T>(work: () => T): { readonly value: T; readonly latencyMs: number } {
  const started = Date.now();
  const value = work();
  return { value, latencyMs: Date.now() - started };
}
