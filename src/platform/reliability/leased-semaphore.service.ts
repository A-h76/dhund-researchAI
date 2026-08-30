import { Inject, Injectable } from '@nestjs/common';
import { LEASE_SERVICE, type LeaseService } from '../../l0/ports';
import { PLATFORM_RELIABILITY_SCOPE } from './queue-liveness.config';

@Injectable()
export class LeasedSemaphoreService {
  constructor(@Inject(LEASE_SERVICE) private readonly leaseService: LeaseService) {}

  async acquire(
    resourceKey: string,
    holderId: string,
    ttlSeconds: number,
  ): Promise<'acquired' | 'renewed' | 'contended'> {
    return this.leaseService.tryAcquire(PLATFORM_RELIABILITY_SCOPE, resourceKey, holderId, ttlSeconds);
  }

  async renewHeartbeat(
    resourceKey: string,
    holderId: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    return this.leaseService.renew(PLATFORM_RELIABILITY_SCOPE, resourceKey, holderId, ttlSeconds);
  }

  async release(resourceKey: string, holderId: string): Promise<boolean> {
    return this.leaseService.release(PLATFORM_RELIABILITY_SCOPE, resourceKey, holderId);
  }

  async getHolder(resourceKey: string): Promise<string | null> {
    return this.leaseService.getHolder(PLATFORM_RELIABILITY_SCOPE, resourceKey);
  }

  buildJobLeaseKey(queue: string, jobId: string): string {
    return `job-lease:${queue}:${jobId}`;
  }
}
