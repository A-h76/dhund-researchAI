import { Inject, Injectable } from '@nestjs/common';
import { CACHE_SERVICE, type CacheService } from '../../l0/ports';
import type { AcquiredGateSlot } from './batch-concurrency-gate.service';
import { EnqueueAdmissionService } from './enqueue-admission.service';

@Injectable()
export class GateSlotRegistry {
  private readonly keyPrefix = 'gate-slot:';

  constructor(
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    private readonly admission: EnqueueAdmissionService,
  ) {}

  async register(jobId: string, slot: AcquiredGateSlot): Promise<void> {
    await this.cache.set('__platform__', `${this.keyPrefix}${jobId}`, JSON.stringify(slot));
  }

  async releaseByJobId(jobId: string): Promise<void> {
    const cacheKey = `${this.keyPrefix}${jobId}`;
    const raw = await this.cache.get('__platform__', cacheKey);
    if (raw === null) {
      return;
    }

    const slot = JSON.parse(raw) as AcquiredGateSlot;
    await this.admission.releaseSlot(slot);
    await this.cache.del('__platform__', cacheKey);
  }
}
