export type ExtractFailureCause =
  | 'missing_version'
  | 'parse_error'
  | 'storage_error'
  | 'persist_error'
  | 'unknown';

export class ExtractMetrics {
  private pagesProcessed = 0;
  private parseLatencyTotalMs = 0;
  private parseCount = 0;
  private ocrRouted = 0;
  private readonly failuresByCause = new Map<ExtractFailureCause, number>();

  recordParse(pages: number, latencyMs: number): void {
    this.pagesProcessed += pages;
    this.parseLatencyTotalMs += latencyMs;
    this.parseCount += 1;
  }

  recordOcrRoute(): void {
    this.ocrRouted += 1;
  }

  recordFailure(cause: ExtractFailureCause): void {
    this.failuresByCause.set(cause, (this.failuresByCause.get(cause) ?? 0) + 1);
  }

  snapshot(): {
    pagesProcessed: number;
    parseCount: number;
    averageParseLatencyMs: number;
    ocrRouted: number;
    failuresByCause: Record<string, number>;
  } {
    return {
      pagesProcessed: this.pagesProcessed,
      parseCount: this.parseCount,
      averageParseLatencyMs:
        this.parseCount === 0 ? 0 : this.parseLatencyTotalMs / this.parseCount,
      ocrRouted: this.ocrRouted,
      failuresByCause: Object.fromEntries(this.failuresByCause.entries()),
    };
  }

  reset(): void {
    this.pagesProcessed = 0;
    this.parseLatencyTotalMs = 0;
    this.parseCount = 0;
    this.ocrRouted = 0;
    this.failuresByCause.clear();
  }
}
