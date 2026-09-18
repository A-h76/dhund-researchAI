import { Injectable } from '@nestjs/common';

/**
 * GAP-COORD-LOCK-01 — advisory lock is a contention optimisation.
 * Correctness must hold when this is disabled (version guard alone).
 */
@Injectable()
export class ResearchRunCoordinationService {
  private advisoryLocksEnabled = true;

  /** Test/GAP-COORD-LOCK-01 hook — disable to prove version-guard correctness. */
  setAdvisoryLocksEnabled(enabled: boolean): void {
    this.advisoryLocksEnabled = enabled;
  }

  areAdvisoryLocksEnabled(): boolean {
    return this.advisoryLocksEnabled;
  }

  /**
   * Production path acquires pg_advisory_xact_lock inside the store TX.
   * When disabled, the operation still runs — version guard remains the safety.
   */
  async withAdvisoryLock<T>(
    _lockName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }
}
