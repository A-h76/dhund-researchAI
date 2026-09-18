import { Inject, Injectable } from '@nestjs/common';
import { AnnSearch } from './ann-search';
import { LexicalSearch } from './lexical-search';
import { armLimit } from './over-fetch';
import { QUERY_EMBED, type QueryEmbedPort } from './query-embed.port';
import { understandQuery } from './query-understanding';
import { RetrievalMetrics } from './retrieval.metrics';
import type {
  IRetrievalService,
  RetrievalArmOutput,
  RetrievalCandidate,
  RetrievalInput,
} from './retrieval.port';

@Injectable()
export class RetrievalService implements IRetrievalService {
  constructor(
    @Inject(QUERY_EMBED) private readonly queryEmbed: QueryEmbedPort,
    private readonly ann: AnnSearch,
    private readonly lexical: LexicalSearch,
    private readonly metrics: RetrievalMetrics,
  ) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalArmOutput> {
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

    const vectorHits: RetrievalCandidate[] = vectorTimed.value.hits.map((hit) => ({
      chunkId: hit.chunkId,
      projectId: hit.projectId,
      documentId: hit.documentId,
      arm: 'vector',
    }));
    const lexicalHits: RetrievalCandidate[] = ftsTimed.value.map((hit) => ({
      chunkId: hit.chunkId,
      projectId: hit.projectId,
      documentId: hit.documentId,
      arm: 'fts',
    }));

    return {
      understoodQuery: understood.text,
      vectorHits,
      ftsHits: lexicalHits,
      timings: {
        queryUnderstandingMs,
        vectorMs: vectorTimed.latencyMs,
        ftsMs: ftsTimed.latencyMs,
      },
      efSearch: vectorTimed.value.efSearch,
      limit,
    };
  }
}

async function timeAsync<T>(
  work: () => Promise<T>,
): Promise<{ readonly value: T; readonly latencyMs: number }> {
  const started = Date.now();
  const value = await work();
  return { value, latencyMs: Date.now() - started };
}
