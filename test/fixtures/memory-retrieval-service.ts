import type { EvidenceLookup, RetrievalTraceStore } from '../../src/l0/ports';
import type { PlatformLogger } from '../../src/platform/logging';
import { AnnSearch } from '../../src/retrieval/ann-search';
import { LexicalSearch } from '../../src/retrieval/lexical-search';
import { RetrievalMetrics } from '../../src/retrieval/retrieval.metrics';
import { RetrievalService } from '../../src/retrieval/retrieval.service';
import type { QueryEmbedPort } from '../../src/retrieval/query-embed.port';
import type { QueryRerankPort } from '../../src/retrieval/rerank.port';
import { buildTestAppConfig } from './app-config.fixture';
import { MemoryEvidenceLookup } from './memory-evidence-lookup';
import { MemoryQueryEmbed } from './memory-query-embed';
import { MemoryRerank } from './memory-rerank';
import { MemoryRetrievalIndexStore } from './memory-retrieval-index';
import { MemoryRetrievalTraces } from './memory-retrieval-traces';
import { MemoryScopedStore } from './memory-scoped-store';

export function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

export function buildRetrievalService(input: {
  readonly store: MemoryScopedStore;
  readonly fts: MemoryRetrievalIndexStore;
  readonly embed?: QueryEmbedPort;
  readonly rerank?: QueryRerankPort;
  readonly metrics?: RetrievalMetrics;
  readonly evidence?: EvidenceLookup;
  readonly traces?: RetrievalTraceStore;
}): {
  readonly service: RetrievalService;
  readonly metrics: RetrievalMetrics;
  readonly rerank: QueryRerankPort;
  readonly evidence: EvidenceLookup;
  readonly traces: RetrievalTraceStore;
} {
  const metrics = input.metrics ?? new RetrievalMetrics(stubLogger());
  const rerank = input.rerank ?? new MemoryRerank();
  const evidence = input.evidence ?? new MemoryEvidenceLookup();
  const traces = input.traces ?? new MemoryRetrievalTraces();
  return {
    metrics,
    rerank,
    evidence,
    traces,
    service: new RetrievalService(
      input.embed ?? new MemoryQueryEmbed(),
      new AnnSearch(input.store, buildTestAppConfig(), metrics),
      new LexicalSearch(input.fts, metrics),
      rerank,
      metrics,
      evidence,
      traces,
    ),
  };
}
