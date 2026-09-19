import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging';
import type { ResearchRunStateName } from '../l0/ports';

export interface ResearchRunMetricsSnapshot {
  readonly runsByState: Readonly<Record<string, number>>;
  readonly tickCount: number;
  readonly tickLatencyMsTotal: number;
  readonly lastTickLatencyMs: number | null;
  readonly lockContentionCount: number;
  readonly recoveryCount: number;
  readonly versionConflictCount: number;
  readonly appliedTransitionCount: number;
  readonly stepsByOutcome: Readonly<Record<string, number>>;
  readonly stepLatencyMsByType: Readonly<Record<string, number>>;
  readonly deferredCount: number;
  readonly lastDagDepth: number | null;
  readonly budgetPauseCount: number;
  readonly budgetIncreaseCount: number;
  readonly lastConsumedMicros: bigint | null;
  readonly lastReservedMicros: bigint | null;
  readonly lastOverageMicros: bigint | null;
  readonly overageSamplesMicros: readonly bigint[];
}

@Injectable()
export class ResearchRunMetrics {
  private readonly runsByState = new Map<string, number>();
  private tickCount = 0;
  private tickLatencyMsTotal = 0;
  private lastTickLatencyMs: number | null = null;
  private lockContentionCount = 0;
  private recoveryCount = 0;
  private versionConflictCount = 0;
  private appliedTransitionCount = 0;
  private readonly stepsByOutcome = new Map<string, number>();
  private readonly stepLatencyMsByType = new Map<string, number>();
  private deferredCount = 0;
  private lastDagDepth: number | null = null;
  private budgetPauseCount = 0;
  private budgetIncreaseCount = 0;
  private lastConsumedMicros: bigint | null = null;
  private lastReservedMicros: bigint | null = null;
  private lastOverageMicros: bigint | null = null;
  private readonly overageSamplesMicros: bigint[] = [];

  constructor(private readonly logger: PlatformLogger) {}

  recordState(state: ResearchRunStateName): void {
    this.runsByState.set(state, (this.runsByState.get(state) ?? 0) + 1);
  }

  recordTick(latencyMs: number): void {
    this.tickCount += 1;
    this.tickLatencyMsTotal += latencyMs;
    this.lastTickLatencyMs = latencyMs;
  }

  /** Performance signal only — not a correctness signal (GAP-COORD-LOCK-01). */
  recordLockContention(): void {
    this.lockContentionCount += 1;
  }

  recordRecovery(): void {
    this.recoveryCount += 1;
    this.logger.info({
      module: 'orchestration.research_run',
      message: 'research_run.coordinator.recovery',
      recoveryCount: this.recoveryCount,
    });
  }

  recordVersionConflict(): void {
    this.versionConflictCount += 1;
  }

  recordAppliedTransition(from: ResearchRunStateName, to: ResearchRunStateName): void {
    this.appliedTransitionCount += 1;
    this.recordState(to);
    this.logger.info({
      module: 'orchestration.research_run',
      message: 'research_run.state_changed',
      fromState: from,
      toState: to,
    });
  }

  recordStepOutcome(outcome: string): void {
    this.stepsByOutcome.set(outcome, (this.stepsByOutcome.get(outcome) ?? 0) + 1);
  }

  recordStepLatency(stepType: string, latencyMs: number): void {
    this.stepLatencyMsByType.set(
      stepType,
      (this.stepLatencyMsByType.get(stepType) ?? 0) + latencyMs,
    );
  }

  recordDeferred(count: number): void {
    this.deferredCount += count;
  }

  recordDagDepth(depth: number): void {
    this.lastDagDepth = depth;
  }

  /** DHB-66 / Experiment H — pause at dispatch with measured overage. */
  recordBudgetPause(input: {
    readonly runId: string;
    readonly consumedMicros: bigint;
    readonly reservedMicros: bigint;
    readonly overageMicros: bigint;
    readonly inFlight: number;
  }): void {
    this.budgetPauseCount += 1;
    this.lastConsumedMicros = input.consumedMicros;
    this.lastReservedMicros = input.reservedMicros;
    this.lastOverageMicros = input.overageMicros;
    this.overageSamplesMicros.push(input.overageMicros);
    this.logger.info({
      module: 'orchestration.research_run',
      message: 'research_run.budget.paused',
      runId: input.runId,
      consumedMicros: input.consumedMicros.toString(),
      reservedMicros: input.reservedMicros.toString(),
      overageMicros: input.overageMicros.toString(),
      inFlight: input.inFlight,
    });
  }

  recordBudgetIncrease(input: {
    readonly runId: string;
    readonly additionalMicros: bigint;
    readonly reservedMicros: bigint;
  }): void {
    this.budgetIncreaseCount += 1;
    this.lastReservedMicros = input.reservedMicros;
    this.logger.info({
      module: 'orchestration.research_run',
      message: 'research_run.budget.increased',
      runId: input.runId,
      additionalMicros: input.additionalMicros.toString(),
      reservedMicros: input.reservedMicros.toString(),
    });
  }

  snapshot(): ResearchRunMetricsSnapshot {
    return {
      runsByState: Object.fromEntries(this.runsByState),
      tickCount: this.tickCount,
      tickLatencyMsTotal: this.tickLatencyMsTotal,
      lastTickLatencyMs: this.lastTickLatencyMs,
      lockContentionCount: this.lockContentionCount,
      recoveryCount: this.recoveryCount,
      versionConflictCount: this.versionConflictCount,
      appliedTransitionCount: this.appliedTransitionCount,
      stepsByOutcome: Object.fromEntries(this.stepsByOutcome),
      stepLatencyMsByType: Object.fromEntries(this.stepLatencyMsByType),
      deferredCount: this.deferredCount,
      lastDagDepth: this.lastDagDepth,
      budgetPauseCount: this.budgetPauseCount,
      budgetIncreaseCount: this.budgetIncreaseCount,
      lastConsumedMicros: this.lastConsumedMicros,
      lastReservedMicros: this.lastReservedMicros,
      lastOverageMicros: this.lastOverageMicros,
      overageSamplesMicros: [...this.overageSamplesMicros],
    };
  }

  reset(): void {
    this.runsByState.clear();
    this.tickCount = 0;
    this.tickLatencyMsTotal = 0;
    this.lastTickLatencyMs = null;
    this.lockContentionCount = 0;
    this.recoveryCount = 0;
    this.versionConflictCount = 0;
    this.appliedTransitionCount = 0;
    this.stepsByOutcome.clear();
    this.stepLatencyMsByType.clear();
    this.deferredCount = 0;
    this.lastDagDepth = null;
    this.budgetPauseCount = 0;
    this.budgetIncreaseCount = 0;
    this.lastConsumedMicros = null;
    this.lastReservedMicros = null;
    this.lastOverageMicros = null;
    this.overageSamplesMicros.length = 0;
  }
}
