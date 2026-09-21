import { Injectable } from '@nestjs/common';
import type { ScreeningDecisionOutcome } from './screening.types';

@Injectable()
export class ScreeningMetrics {
  private recorded = 0;
  private readonly byOutcome: Record<ScreeningDecisionOutcome, number> = {
    include: 0,
    exclude: 0,
    unresolved: 0,
  };

  recordDecision(outcome: ScreeningDecisionOutcome): void {
    this.recorded += 1;
    this.byOutcome[outcome] += 1;
  }

  snapshot(): {
    readonly decisionsRecorded: number;
    readonly byOutcome: Readonly<Record<ScreeningDecisionOutcome, number>>;
  } {
    return {
      decisionsRecorded: this.recorded,
      byOutcome: { ...this.byOutcome },
    };
  }

  reset(): void {
    this.recorded = 0;
    this.byOutcome.include = 0;
    this.byOutcome.exclude = 0;
    this.byOutcome.unresolved = 0;
  }
}
