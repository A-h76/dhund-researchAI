import { Inject, Injectable } from '@nestjs/common';
import {
  BILLING_STORE,
  QUEUE_SERVICE,
  SECRETS_SERVICE,
  type BillingStore,
  type QueueService,
  type SecretsService,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { runWithCorrelationIdAsync } from '../platform/logging/correlation-context';
import { deriveJobId, getQueuePolicy, resolveAttempts } from '../platform/queues';
import { BillingMetrics } from './billing.metrics';
import { parseStripeEnvelope, readSubscriptionSnapshot } from './stripe-event';
import { verifyStripeSignature } from './stripe-signature';

/** Security bound for the webhook body. Not a plan cap. */
export const WEBHOOK_MAX_BODY_BYTES = 65_536;

const WEBHOOK_SECRET = 'STRIPE_WEBHOOK_SECRET';

export type WebhookReceipt = { readonly outcome: 'accepted' | 'duplicate' };

@Injectable()
export class StripeWebhookService {
  constructor(
    @Inject(BILLING_STORE) private readonly store: BillingStore,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    @Inject(SECRETS_SERVICE) private readonly secrets: SecretsService,
    private readonly metrics: BillingMetrics,
  ) {}

  async receive(input: {
    rawBody: Buffer;
    signature: string | undefined;
    nowMs?: number;
  }): Promise<WebhookReceipt> {
    if (input.rawBody.length > WEBHOOK_MAX_BODY_BYTES) {
      this.metrics.recordWebhook('unknown', 'oversized');
      throw new DomainError(ErrorCode.FileTooLarge, { module: 'billing' });
    }

    const valid = verifyStripeSignature(
      input.rawBody,
      input.signature,
      this.secrets.getSecret(WEBHOOK_SECRET),
      input.nowMs ?? Date.now(),
    );
    if (!valid) {
      this.metrics.recordWebhook('unknown', 'invalid_signature');
      throw new DomainError(ErrorCode.MalformedRequest, { module: 'billing' });
    }

    const envelope = parseStripeEnvelope(input.rawBody);
    if (envelope === null) {
      this.metrics.recordWebhook('unknown', 'malformed');
      throw new DomainError(ErrorCode.MalformedRequest, { module: 'billing' });
    }

    const inserted = await this.store.insertStripeEvent({
      id: envelope.id,
      type: envelope.type,
      payload: envelope.payload,
    });
    if (inserted === 'duplicate') {
      this.metrics.recordWebhook(envelope.type, 'duplicate');
      return { outcome: 'duplicate' };
    }

    const snapshot = readSubscriptionSnapshot(envelope.payload);
    const orgId = snapshot?.orgId ?? 'billing';
    const payload = {
      orgId,
      correlationId: envelope.id,
      stripeEventId: envelope.id,
    };
    const policy = getQueuePolicy('billing-sync');
    const attempts = resolveAttempts(policy);
    await runWithCorrelationIdAsync(envelope.id, async () => {
      await this.queue.addJob('billing-sync', payload, {
        jobId: deriveJobId('billing-sync', payload),
        ...(attempts !== undefined ? { attempts } : {}),
        ...(policy.backoff !== null ? { backoff: policy.backoff } : {}),
      });
    });
    this.metrics.recordWebhook(envelope.type, 'accepted');
    return { outcome: 'accepted' };
  }
}
