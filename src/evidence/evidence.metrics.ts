import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging';
import type { StoredEvidenceStance } from '../l0/ports/evidence-spine.port';
import type { LocatorRejectionReason } from './locator';
import { stanceDistribution } from './stance-map';

export type EvidenceTypeValue = 'body_grounded' | 'metadata_only';
export type ExtractionMethodValue = 'deterministic' | 'llm' | 'human';

export interface EvidenceMetricsSnapshot {
  readonly created: number;
  readonly createdByType: Readonly<Record<EvidenceTypeValue, number>>;
  readonly createdByMethod: Readonly<Record<ExtractionMethodValue, number>>;
  readonly locatorRejections: number;
  readonly evidenceExtracted: number;
  readonly extractionFailureRate: number;
  readonly costPerExtractionMicros: number;
  readonly omittedLocatorCount: number;
  readonly stanceDistribution: ReturnType<typeof stanceDistribution>;
}

@Injectable()
export class EvidenceMetrics {
  private created = 0;
  private locatorRejections = 0;
  private extracted = 0;
  private extractFailures = 0;
  private extractCostMicros = 0;
  private omittedLocators = 0;
  private readonly stances: StoredEvidenceStance[] = [];
  private readonly createdByType: Record<EvidenceTypeValue, number> = {
    body_grounded: 0,
    metadata_only: 0,
  };
  private readonly createdByMethod: Record<ExtractionMethodValue, number> = {
    deterministic: 0,
    llm: 0,
    human: 0,
  };

  constructor(private readonly logger?: PlatformLogger) {}

  recordCreated(type: EvidenceTypeValue, method: ExtractionMethodValue): void {
    this.created += 1;
    this.createdByType[type] += 1;
    this.createdByMethod[method] += 1;
    this.logger?.info({
      module: 'evidence',
      message: 'evidence.created',
      type,
      method,
    });
  }

  recordRejection(reason: LocatorRejectionReason): void {
    this.locatorRejections += 1;
    this.logger?.warn({
      module: 'evidence',
      message: 'evidence.locator_rejected',
      reason,
    });
  }

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

  snapshot(): EvidenceMetricsSnapshot {
    const extractAttempts = this.extracted + this.extractFailures;
    return {
      created: this.created,
      createdByType: { ...this.createdByType },
      createdByMethod: { ...this.createdByMethod },
      locatorRejections: this.locatorRejections,
      evidenceExtracted: this.extracted,
      extractionFailureRate: extractAttempts === 0 ? 0 : this.extractFailures / extractAttempts,
      costPerExtractionMicros: this.extracted === 0 ? 0 : this.extractCostMicros / this.extracted,
      omittedLocatorCount: this.omittedLocators,
      stanceDistribution: stanceDistribution(this.stances),
    };
  }
}
