import { Injectable, Optional } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging';
import { MetricsSurface } from '../platform/observability/metrics-surface';

export type ExtractFailureCause =
  | 'invalid_pdf'
  | 'storage'
  | 'version_missing'
  | 'parse';

export interface ExtractMetricsSnapshot {
  readonly pagesParsed: number;
  readonly parseLatencyMs: number;
  readonly ocrRouted: number;
  readonly pagesPerHour: number;
  readonly failures: Readonly<Record<ExtractFailureCause, number>>;
}

@Injectable()
export class ExtractMetrics {
  private pagesParsed = 0;
  private parseLatencyMs = 0;
  private ocrRouted = 0;
  private readonly failures: Record<ExtractFailureCause, number> = {
    invalid_pdf: 0,
    storage: 0,
    version_missing: 0,
    parse: 0,
  };

  constructor(
    private readonly logger: PlatformLogger,
    @Optional() private readonly surface?: MetricsSurface,
  ) {}

  recordSuccess(pages: number, durationMs: number): void {
    this.pagesParsed += pages;
    this.surface?.recordIngestion('extract', pages);
    this.parseLatencyMs += durationMs;
    this.logger.info({
      module: 'ingestion',
      message: 'extract.completed',
      pages,
      durationMs,
    });
  }

  recordOcrRoute(pageCount: number): void {
    this.ocrRouted += 1;
    this.logger.info({
      module: 'ingestion',
      message: 'extract.ocr_routed',
      pageCount,
    });
  }

  recordFailure(cause: ExtractFailureCause): void {
    this.failures[cause] += 1;
    this.logger.warn({
      module: 'ingestion',
      message: 'extract.failed',
      cause,
    });
  }

  snapshot(): ExtractMetricsSnapshot {
    const hours = this.parseLatencyMs / 3_600_000;
    return {
      pagesParsed: this.pagesParsed,
      parseLatencyMs: this.parseLatencyMs,
      ocrRouted: this.ocrRouted,
      pagesPerHour: hours > 0 ? this.pagesParsed / hours : 0,
      failures: { ...this.failures },
    };
  }
}
