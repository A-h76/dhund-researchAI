import { Inject, Injectable } from '@nestjs/common';
import { PUBSUB_SERVICE, type PubSubService } from '../../l0/ports';
import type { EventEnvelope } from './envelope';
import { realtimeChannelForOrg } from './realtime-channels';

/**
 * Publishes advisory realtime projections over Redis pub/sub.
 * Never authoritative — outbox remains the source of truth.
 */
@Injectable()
export class RealtimeProjectionPublisher {
  constructor(@Inject(PUBSUB_SERVICE) private readonly pubsub: PubSubService) {}

  async publishAdvisory(envelope: EventEnvelope): Promise<void> {
    const channel = realtimeChannelForOrg(envelope.orgId);
    await this.pubsub.publish(channel, JSON.stringify(envelope));
  }
}
