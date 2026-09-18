import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging';

export type OcrFailureCause = 'version_missing' | 'gateway' | 'empty_ocr' | 'storage';

export interface OcrMetricsSnapshot {
  readonly pagesOcred: number;
  readonly pagesPerHour: number;
  readonly costMicros: number;
  readonly lowConfidence: number;
  readonly failures: Readonly<Record<OcrFailureCause, number>>;
}

@Injectable()
export class OcrMetrics {
  private pagesOcred = 0;
  private durationMs = 0;
  private costMicros = 0;
  private lowConfidence = 0;
  private readonly failures: Record<OcrFailureCause, number> = {
    version_missing: 0,
    gateway: 0,
    empty_ocr: 0,
    storage: 0,
  };

  constructor(private readonly logger: PlatformLogger) {}

  recordSuccess(input: {
    readonly pages: number;
    readonly durationMs: number;
    readonly costMicros: number;
    readonly meanConfidence: number;
    readonly partial: boolean;
  }): void {
    this.pagesOcred += input.pages;
    this.durationMs += input.durationMs;
    this.costMicros += input.costMicros;
    if (input.partial) {
      this.lowConfidence += 1;
    }
    this.logger.info({
      module: 'ai.ocr',
      message: 'ocr.completed',
      pages: input.pages,
      durationMs: input.durationMs,
      costMicros: input.costMicros,
      meanConfidence: input.meanConfidence,
      partial: input.partial,
    });
  }

  recordFailure(cause: OcrFailureCause): void {
    this.failures[cause] += 1;
    this.logger.warn({
      module: 'ai.ocr',
      message: 'ocr.failed',
      cause,
    });
  }

  snapshot(): OcrMetricsSnapshot {
    const hours = this.durationMs / 3_600_000;
    return {
      pagesOcred: this.pagesOcred,
      pagesPerHour: hours > 0 ? this.pagesOcred / hours : 0,
      costMicros: this.costMicros,
      lowConfidence: this.lowConfidence,
      failures: { ...this.failures },
    };
  }
}
