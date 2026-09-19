import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging';
import type { ExtractionCellStatusName } from '../l0/ports/extraction-matrix.port';

export interface ExtractionMatrixMetricsSnapshot {
  readonly cellsByOutcome: Readonly<Record<string, number>>;
  readonly typeMismatchRejections: number;
  readonly costMicrosTotal: number;
  readonly cellsWithCost: number;
  readonly schemasCreated: number;
  readonly runsCreated: number;
}

@Injectable()
export class ExtractionMatrixMetrics {
  private readonly cellsByOutcome = new Map<string, number>();
  private typeMismatchRejections = 0;
  private costMicrosTotal = 0;
  private cellsWithCost = 0;
  private schemasCreated = 0;
  private runsCreated = 0;

  constructor(private readonly logger: PlatformLogger) {}

  recordSchemaCreated(): void {
    this.schemasCreated += 1;
  }

  recordRunCreated(cellCount: number): void {
    this.runsCreated += 1;
    this.logger.info({
      module: 'orchestration.extraction',
      message: 'extraction_run.created',
      cellCount,
    });
  }

  recordCellOutcome(status: ExtractionCellStatusName): void {
    this.cellsByOutcome.set(status, (this.cellsByOutcome.get(status) ?? 0) + 1);
  }

  recordTypeMismatch(): void {
    this.typeMismatchRejections += 1;
    this.logger.info({
      module: 'orchestration.extraction',
      message: 'extraction_cell.type_mismatch',
      typeMismatchRejections: this.typeMismatchRejections,
      mismatchRate: this.mismatchRate(),
    });
  }

  recordCellCost(costMicros: number): void {
    this.costMicrosTotal += costMicros;
    this.cellsWithCost += 1;
  }

  mismatchRate(): number {
    const outcomes = [...this.cellsByOutcome.values()].reduce((a, b) => a + b, 0);
    const denom = outcomes + this.typeMismatchRejections;
    return denom === 0 ? 0 : this.typeMismatchRejections / denom;
  }

  snapshot(): ExtractionMatrixMetricsSnapshot {
    return {
      cellsByOutcome: Object.fromEntries(this.cellsByOutcome),
      typeMismatchRejections: this.typeMismatchRejections,
      costMicrosTotal: this.costMicrosTotal,
      cellsWithCost: this.cellsWithCost,
      schemasCreated: this.schemasCreated,
      runsCreated: this.runsCreated,
    };
  }

  reset(): void {
    this.cellsByOutcome.clear();
    this.typeMismatchRejections = 0;
    this.costMicrosTotal = 0;
    this.cellsWithCost = 0;
    this.schemasCreated = 0;
    this.runsCreated = 0;
  }
}
