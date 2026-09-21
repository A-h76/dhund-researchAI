import { Injectable } from '@nestjs/common';

export interface ConnectorRateLimitConfig {
  /** Minimum gap between outbound calls for a provider. */
  readonly minIntervalMs: number;
}

const DEFAULT_MIN_INTERVAL_MS = 3_000;

/**
 * Simple per-provider spacing. Call sites await before egress.
 * A 429 from the provider is handled separately as a retryable job error.
 */
@Injectable()
export class ConnectorRateLimiter {
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly configs = new Map<string, ConnectorRateLimitConfig>();

  configure(provider: string, config: ConnectorRateLimitConfig): void {
    this.configs.set(provider, config);
  }

  async wait(provider: string, nowMs: number = Date.now()): Promise<void> {
    const minIntervalMs = this.configs.get(provider)?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    const allowedAt = this.nextAllowedAt.get(provider) ?? 0;
    const delay = Math.max(0, allowedAt - nowMs);
    this.nextAllowedAt.set(provider, Math.max(nowMs, allowedAt) + minIntervalMs);
    if (delay > 0) {
      await sleep(delay);
    }
  }

  /** Record a Retry-After style backoff after HTTP 429. */
  penalize(provider: string, backoffMs: number, nowMs: number = Date.now()): void {
    const current = this.nextAllowedAt.get(provider) ?? nowMs;
    this.nextAllowedAt.set(provider, Math.max(current, nowMs + backoffMs));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
