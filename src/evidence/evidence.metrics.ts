import { Injectable } from '@nestjs/common';
import type { StoredEvidenceStance } from '../l0/ports/evidence-spine.port';
import { stanceDistribution } from './stance-map';

@Injectable()
export class EvidenceMetrics {
  private extracted = 0;
  private extractFailures = 0;
  private extractCostMicros = 0;
  private omittedLocators = 0;
  private readonly stances: StoredEvidenceStance[] = [];

  recordExtraction(input: {
    evidenceCount: number;
    omittedLocatorCount: number;
    costMicros: number;
  }): void {
    this.extracted += input.evidenceCount;
    this.omittedLocators += input.omittedLocatorCount;
    this.extractCostMicros += input.costMicros;
  }

  recordExtractionFailure(): void {
    this.extractFailures += 1;
  }

  recordStance(stance: StoredEvidenceStance): void {
    this.stances.push(stance);
  }

  snapshot(): {
    evidenceExtracted: number;
    extractionFailureRate: number;
    costPerExtractionMicros: number;
    omittedLocatorCount: number;
    stanceDistribution: ReturnType<typeof stanceDistribution>;
  } {
    const extractAttempts = this.extracted + this.extractFailures;
    return {
      evidenceExtracted: this.extracted,
      extractionFailureRate: extractAttempts === 0 ? 0 : this.extractFailures / extractAttempts,
      costPerExtractionMicros: this.extracted === 0 ? 0 : this.extractCostMicros / this.extracted,
      omittedLocatorCount: this.omittedLocators,
      stanceDistribution: stanceDistribution(this.stances),
    };
  }

  reset(): void {
    this.extracted = 0;
    this.extractFailures = 0;
    this.extractCostMicros = 0;
    this.omittedLocators = 0;
    this.stances.length = 0;
  }
}
