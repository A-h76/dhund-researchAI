import { Inject, Injectable } from '@nestjs/common';
import { RuntimeRole } from '../platform/runtime/role';
import { AnnSearch } from './ann-search';
import { authzRecheck } from './authz-recheck';
import { bm25Scores } from './bm25';
import { LexicalSearch } from './lexical-search';
import { armLimit } from './over-fetch';
import { QUERY_EMBED, type QueryEmbedPort } from './query-embed.port';
import { understandQuery } from './query-understanding';
import { QUERY_RERANK, type QueryRerankPort } from './rerank.port';
import { RetrievalMetrics } from './retrieval.metrics';
import type {
  IRetrievalService,
  RankedCandidate,
  RetrievalCandidate,
  RetrievalInput,
  RetrievalResult,
} from './retrieval.port';
import { fuseRrf, ineligibleCountAtFusionBoundary, orderByScores } from './rrf';

@Injectable()
export class RetrievalService implements IRetrievalService {
  constructor(
    @Inject(QUERY_EMBED) private readonly queryEmbed: QueryEmbedPort,
    private readonly ann: AnnSearch,
    private readonly lexical: LexicalSearch,
    @Inject(QUERY_RERANK) private readonly queryRerank: QueryRerankPort,
    private readonly metrics: RetrievalMetrics,
  ) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalResult> {
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

    const [vectorTimed, ftsTimed] = await Promise.all([
      timeAsync(() => this.ann.nearest(scope, vectorLiteral, limit, input.efSearch)),
      timeAsync(() => this.lexical.search(scope, understood.text, limit)),
    ]);
    this.metrics.recordStageLatency('vector', vectorTimed.latencyMs);
    this.metrics.recordStageLatency('fts', ftsTimed.latencyMs);

    const vectorHits: RetrievalCandidate[] = vectorTimed.value.hits.map((hit) =>
      toCandidate(hit, 'vector'),
    );
    const ftsHits: RetrievalCandidate[] = ftsTimed.value.map((hit) => toCandidate(hit, 'fts'));

    const rrfTimed = timeSync(() => {
      const ineligible = ineligibleCountAtFusionBoundary(vectorHits, ftsHits);
      if (ineligible !== 0) {
        throw new Error('ineligible candidate present at fusion boundary');
      }
      return fuseRrf(vectorHits, ftsHits);
    });
    this.metrics.recordStageLatency('rrf', rrfTimed.latencyMs);
    const fused = rrfTimed.value;

    let rerankMethod: 'llm' | 'deterministic' = 'deterministic';
    let rerankExecutionId: string | null = null;
    const rerankTimed = await timeAsync(async () => {
      const ranked = await this.rerankFused(input, understood.text, fused);
      rerankMethod = ranked.method;
      rerankExecutionId = ranked.aiExecutionId;
      return ranked.hits;
    });
    this.metrics.recordStageLatency('rerank', rerankTimed.latencyMs);

    const surviving = authzRecheck(rerankTimed.value, input.projectId);
    const shortfall = this.metrics.recordFilteredRecall(fused.length, surviving.length);
    const hits = surviving.slice(0, input.k);

    return {
      understoodQuery: understood.text,
      vectorHits,
      ftsHits,
      hits,
      timings: {
        queryUnderstandingMs,
        vectorMs: vectorTimed.latencyMs,
        ftsMs: ftsTimed.latencyMs,
        rrfMs: rrfTimed.latencyMs,
        rerankMs: rerankTimed.latencyMs,
      },
      efSearch: vectorTimed.value.efSearch,
      limit,
      rerankMethod,
      rerankExecutionId,
      filteredRecallShortfall: shortfall,
    };
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
  hit: { readonly chunkId: string; readonly projectId: string; readonly documentId: string; readonly text?: string },
  arm: RetrievalCandidate['arm'],
): RetrievalCandidate {
  return {
    chunkId: hit.chunkId,
    projectId: hit.projectId,
    documentId: hit.documentId,
    text: hit.text ?? '',
    arm,
  };
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
