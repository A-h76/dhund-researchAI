import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging';
import type { LocatorRejectionReason } from './locator';

export type EvidenceTypeValue = 'body_grounded' | 'metadata_only';
export type ExtractionMethodValue = 'deterministic' | 'llm' | 'human';

export interface EvidenceMetricsSnapshot {
  readonly created: number;
  readonly createdByType: Readonly<Record<EvidenceTypeValue, number>>;
  readonly createdByMethod: Readonly<Record<ExtractionMethodValue, number>>;
  readonly locatorRejections: number;
}

@Injectable()
export class EvidenceMetrics {
  private created = 0;
  private locatorRejections = 0;
  private readonly createdByType: Record<EvidenceTypeValue, number> = {
    body_grounded: 0,
    metadata_only: 0,
  };
  private readonly createdByMethod: Record<ExtractionMethodValue, number> = {
    deterministic: 0,
    llm: 0,
    human: 0,
  };

  constructor(private readonly logger: PlatformLogger) {}

  recordCreated(type: EvidenceTypeValue, method: ExtractionMethodValue): void {
    this.created += 1;
    this.createdByType[type] += 1;
    this.createdByMethod[method] += 1;
    this.logger.info({
      module: 'evidence',
      message: 'evidence.created',
      type,
      method,
    });
  }

  recordRejection(reason: LocatorRejectionReason): void {
    this.locatorRejections += 1;
    this.logger.warn({
      module: 'evidence',
      message: 'evidence.locator_rejected',
      reason,
    });
  }

  snapshot(): EvidenceMetricsSnapshot {
    return {
      created: this.created,
      createdByType: { ...this.createdByType },
      createdByMethod: { ...this.createdByMethod },
      locatorRejections: this.locatorRejections,
    };
  }
}
