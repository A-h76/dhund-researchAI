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
  }
}
