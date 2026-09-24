import { Injectable, Optional } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging';
import { MetricsSurface } from '../../platform/observability/metrics-surface';

export type EmbedFailureCause =
  | 'chunk_missing'
  | 'inactive_model_version'
  | 'gateway'
  | 'rate_limited'
  | 'dimension_mismatch'
  | 'write';

export interface EmbedMetricsSnapshot {
  readonly embeddingsWritten: number;
  readonly embeddingsSkipped: number;
  readonly tokensIn: number;
  readonly costMicros: number;
  readonly requests: number;
  readonly rateLimited: number;
  readonly rateLimitedRate: number;
  readonly documentsDegraded: number;
  readonly backfillProgress: Readonly<Record<string, number>>;
  readonly failures: Readonly<Record<EmbedFailureCause, number>>;
}

/**
 * Cost and token totals here mirror what the gateway already wrote to
 * ai_executions; this snapshot is the in-process view used by readiness and
 * tests, not a second ledger.
 */
@Injectable()
export class EmbedMetrics {
  private embeddingsWritten = 0;
  private embeddingsSkipped = 0;
  private tokensIn = 0;
  private costMicros = 0;
  private requests = 0;
  private rateLimited = 0;
  private documentsDegraded = 0;
  private readonly backfillProgress = new Map<string, number>();
  private readonly failures: Record<EmbedFailureCause, number> = {
    chunk_missing: 0,
    inactive_model_version: 0,
    gateway: 0,
    rate_limited: 0,
    dimension_mismatch: 0,
    write: 0,
  };

  constructor(
    private readonly logger: PlatformLogger,
    @Optional() private readonly surface?: MetricsSurface,
  ) {}

  recordRequest(input: {
    readonly textCount: number;
    readonly tokensIn: number;
    readonly costMicros: number;
    readonly latencyMs: number;
    readonly modelVersion: string;
  }): void {
    this.requests += 1;
    this.tokensIn += input.tokensIn;
    this.costMicros += input.costMicros;
    this.logger.info({
      module: 'ai.embed',
      message: 'embed.request.completed',
      textCount: input.textCount,
      tokensIn: input.tokensIn,
      costMicros: input.costMicros,
      latencyMs: input.latencyMs,
      modelVersion: input.modelVersion,
    });
  }

  recordWrite(input: {
    readonly written: number;
    readonly skipped: number;
    readonly modelVersion: string;
  }): void {
    this.embeddingsWritten += input.written;
    this.surface?.recordIngestion('embed', input.written);
    this.embeddingsSkipped += input.skipped;
    this.logger.info({
      module: 'ai.embed',
      message: 'embed.completed',
      written: input.written,
      skipped: input.skipped,
      modelVersion: input.modelVersion,
    });
  }

  recordBackfillProgress(input: {
    readonly batchId: string;
    readonly modelVersion: string;
    readonly scanned: number;
    readonly written: number;
    readonly skipped: number;
  }): void {
    const previous = this.backfillProgress.get(input.batchId) ?? 0;
    this.backfillProgress.set(input.batchId, previous + input.scanned);
    this.logger.info({
      module: 'ai.embed',
      message: 'embed.backfill.progress',
      batchId: input.batchId,
      modelVersion: input.modelVersion,
      scanned: input.scanned,
      written: input.written,
      skipped: input.skipped,
    });
  }

  recordDocumentDegraded(documentId: string): void {
    this.documentsDegraded += 1;
    this.logger.warn({
      module: 'ai.embed',
      message: 'embed.document.partial',
      documentId,
    });
  }

  recordFailure(cause: EmbedFailureCause): void {
    this.failures[cause] += 1;
    if (cause === 'rate_limited') {
      this.rateLimited += 1;
    }
    this.logger.warn({
      module: 'ai.embed',
      message: 'embed.failed',
      cause,
    });
  }

  snapshot(): EmbedMetricsSnapshot {
    return {
      embeddingsWritten: this.embeddingsWritten,
      embeddingsSkipped: this.embeddingsSkipped,
      tokensIn: this.tokensIn,
      costMicros: this.costMicros,
      requests: this.requests,
      rateLimited: this.rateLimited,
      rateLimitedRate: this.requests > 0 ? this.rateLimited / this.requests : 0,
      documentsDegraded: this.documentsDegraded,
      backfillProgress: Object.fromEntries(this.backfillProgress),
      failures: { ...this.failures },
    };
  }
}
