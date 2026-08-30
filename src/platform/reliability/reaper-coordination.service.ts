import { Inject, Injectable } from '@nestjs/common';
import { LEASE_SERVICE, type LeaseService } from '../../l0/ports';
import { PLATFORM_RELIABILITY_SCOPE } from './queue-liveness.config';

export type RecoveryClaimResult = 'claimed' | 'noop';

@Injectable()
export class ReaperCoordinationService {
  constructor(@Inject(LEASE_SERVICE) private readonly leaseService: LeaseService) {}

  async tryClaimTick(tickBucket: string, holderId: string): Promise<RecoveryClaimResult> {
    const result = await this.leaseService.tryAcquire(
      PLATFORM_RELIABILITY_SCOPE,
      `reaper:tick:${tickBucket}`,
      holderId,
      120,
    );
    return result === 'contended' ? 'noop' : 'claimed';
  }

  async tryClaimRecovery(
    queue: string,
    jobId: string,
    holderId: string,
  ): Promise<RecoveryClaimResult> {
    const result = await this.leaseService.tryAcquire(
      PLATFORM_RELIABILITY_SCOPE,
      `reaper:recover:${queue}:${jobId}`,
      holderId,
      120,
    );
    return result === 'contended' ? 'noop' : 'claimed';
  }

  async releaseRecoveryClaim(queue: string, jobId: string, holderId: string): Promise<void> {
    await this.leaseService.release(
      PLATFORM_RELIABILITY_SCOPE,
      `reaper:recover:${queue}:${jobId}`,
      holderId,
    );
  }

  /** GAP-COORD-LOCK-01 — advisory lock stub; correctness does not depend on this. */
  async withAdvisoryLock<T>(
    _lockName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }
}
