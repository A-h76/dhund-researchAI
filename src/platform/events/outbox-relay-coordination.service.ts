import { Inject, Injectable } from '@nestjs/common';
import { LEASE_SERVICE, type LeaseService } from '../../l0/ports';
import { PLATFORM_EVENTS_SCOPE, OUTBOX_RELAY_LEASE_TTL_SECONDS } from './outbox-relay.config';

export type RelayClaimResult = 'claimed' | 'noop';

@Injectable()
export class OutboxRelayCoordinationService {
  constructor(@Inject(LEASE_SERVICE) private readonly leaseService: LeaseService) {}

  async tryClaimTick(tickBucket: string, holderId: string): Promise<RelayClaimResult> {
    const result = await this.leaseService.tryAcquire(
      PLATFORM_EVENTS_SCOPE,
      `outbox-relay:tick:${tickBucket}`,
      holderId,
      OUTBOX_RELAY_LEASE_TTL_SECONDS,
    );
    return result === 'contended' ? 'noop' : 'claimed';
  }
}
