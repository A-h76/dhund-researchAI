import { Injectable } from '@nestjs/common';

export type CitationExportFormat = 'csl' | 'bibtex' | 'ris';

@Injectable()
export class CitationMetrics {
  private projectionCount = 0;
  private projectionLatencyMsTotal = 0;
  private brokenChainCount = 0;
  private bindingResolutionFailures = 0;
  private readonly exportsByFormat: Record<CitationExportFormat, number> = {
    csl: 0,
    bibtex: 0,
    ris: 0,
  };

  recordProjection(input: { latencyMs: number; broken: boolean }): void {
    this.projectionCount += 1;
    this.projectionLatencyMsTotal += input.latencyMs;
    if (input.broken) {
      this.brokenChainCount += 1;
    }
  }

  recordExport(format: CitationExportFormat): void {
    this.exportsByFormat[format] += 1;
  }

  recordBindingResolutionFailure(): void {
    this.bindingResolutionFailures += 1;
  }

  snapshot(): {
    projectionCount: number;
    projectionLatencyMs: number;
    brokenChainCount: number;
    bindingResolutionFailures: number;
    exportsByFormat: Record<CitationExportFormat, number>;
  } {
    return {
      projectionCount: this.projectionCount,
      projectionLatencyMs:
        this.projectionCount === 0
          ? 0
          : this.projectionLatencyMsTotal / this.projectionCount,
      brokenChainCount: this.brokenChainCount,
      bindingResolutionFailures: this.bindingResolutionFailures,
      exportsByFormat: { ...this.exportsByFormat },
    };
  }

  reset(): void {
    this.projectionCount = 0;
    this.projectionLatencyMsTotal = 0;
    this.brokenChainCount = 0;
    this.bindingResolutionFailures = 0;
    this.exportsByFormat.csl = 0;
    this.exportsByFormat.bibtex = 0;
    this.exportsByFormat.ris = 0;
  }
}
