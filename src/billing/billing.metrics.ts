import { Injectable } from '@nestjs/common';

export type WebhookOutcome =
  | 'accepted'
  | 'duplicate'
  | 'invalid_signature'
  | 'oversized'
  | 'malformed';

export interface UsageObservation {
  readonly orgId: string;
  readonly period: string;
  readonly metric: string;
  readonly value: string;
}

@Injectable()
export class BillingMetrics {
  private readonly byOutcome: Record<WebhookOutcome, number> = {
    accepted: 0,
    duplicate: 0,
    invalid_signature: 0,
    oversized: 0,
    malformed: 0,
  };
  private readonly byType = new Map<string, number>();
  private duplicateShortCircuits = 0;
  private reconciliationDrift = 0;
  private readonly entitlements = new Map<string, number>();
  private readonly usage = new Map<string, UsageObservation>();

  recordWebhook(type: string, outcome: WebhookOutcome): void {
    switch (outcome) {
      case 'accepted':
      case 'duplicate':
      case 'invalid_signature':
      case 'oversized':
      case 'malformed':
        this.byOutcome[outcome] += 1;
        break;
      default: {
        const unhandled: never = outcome;
        throw new Error(`Unhandled webhook outcome: ${String(unhandled)}`);
      }
    }
    this.byType.set(type, (this.byType.get(type) ?? 0) + 1);
    if (outcome === 'duplicate') {
      this.duplicateShortCircuits += 1;
    }
  }

  recordDrift(count: number): void {
    this.reconciliationDrift = count;
  }

  recordEntitlement(kind: string): void {
    this.entitlements.set(kind, (this.entitlements.get(kind) ?? 0) + 1);
  }

  recordUsage(orgId: string, period: string, metric: string, value: bigint): void {
    this.usage.set(`${orgId}:${period}:${metric}`, {
      orgId,
      period,
      metric,
      value: value.toString(),
    });
  }

  snapshot(): {
    byOutcome: Record<WebhookOutcome, number>;
    byType: Record<string, number>;
    duplicateShortCircuits: number;
    reconciliationDrift: number;
    entitlements: Record<string, number>;
    usage: UsageObservation[];
  } {
    return {
      byOutcome: { ...this.byOutcome },
      byType: Object.fromEntries(this.byType),
      duplicateShortCircuits: this.duplicateShortCircuits,
      reconciliationDrift: this.reconciliationDrift,
      entitlements: Object.fromEntries(this.entitlements),
      usage: [...this.usage.values()],
    };
  }
}
