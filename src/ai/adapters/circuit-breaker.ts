import { Inject, Injectable, Optional } from '@nestjs/common';
import { PlatformLogger } from '../../platform/logging/platform-logger.service';
import type { PolicyProvider } from '../policy/policy.types';
import { SystemAdapterClock, type AdapterClock } from './clock';

export const ADAPTER_CLOCK = Symbol('ADAPTER_CLOCK');

export const CIRCUIT_CONSECUTIVE_FAILURES = 5;
export const CIRCUIT_FAILURE_RATE_THRESHOLD = 0.5;
export const CIRCUIT_WINDOW_MS = 60_000;
export const CIRCUIT_HALF_OPEN_AFTER_MS = 30_000;
export const CIRCUIT_MIN_SAMPLES_FOR_RATE = 6;

export type CircuitState = 'closed' | 'open' | 'half_open';

interface OutcomeSample {
  readonly atMs: number;
  readonly success: boolean;
}

export class ProviderCircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAtMs = 0;
  private probeInFlight = false;
  private readonly samples: OutcomeSample[] = [];

  constructor(
    readonly provider: PolicyProvider,
    private readonly clock: AdapterClock,
    private readonly logger?: PlatformLogger,
  ) {}

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  allowRequest(): boolean {
    this.maybeTransitionToHalfOpen();

    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        return false;
      case 'half_open':
        if (this.probeInFlight) {
          return false;
        }
        this.probeInFlight = true;
        return true;
      default: {
        const _exhaustive: never = this.state;
        return _exhaustive;
      }
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.pushSample(true);
    this.probeInFlight = false;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    this.pushSample(false);
    this.probeInFlight = false;

    if (
      this.consecutiveFailures >= CIRCUIT_CONSECUTIVE_FAILURES ||
      this.failureRateExceeded()
    ) {
      this.open();
      return;
    }

    if (this.state === 'half_open') {
      this.open();
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== 'open') {
      return;
    }
    if (this.clock.now() - this.openedAtMs >= CIRCUIT_HALF_OPEN_AFTER_MS) {
      this.state = 'half_open';
      this.probeInFlight = false;
    }
  }

  private failureRateExceeded(): boolean {
    const cutoff = this.clock.now() - CIRCUIT_WINDOW_MS;
    const window = this.samples.filter((sample) => sample.atMs >= cutoff);
    if (window.length < CIRCUIT_MIN_SAMPLES_FOR_RATE) {
      return false;
    }
    const failures = window.filter((sample) => !sample.success).length;
    return failures / window.length > CIRCUIT_FAILURE_RATE_THRESHOLD;
  }

  private open(): void {
    const wasOpen = this.state === 'open';
    this.state = 'open';
    this.openedAtMs = this.clock.now();
    this.probeInFlight = false;
    if (!wasOpen) {
      this.logger?.info({
        module: 'ai.adapters',
        message: 'ai.circuit.opened',
        provider: this.provider,
        consecutiveFailures: this.consecutiveFailures,
      });
    }
  }

  private pushSample(success: boolean): void {
    const now = this.clock.now();
    this.samples.push({ atMs: now, success });
    const cutoff = now - CIRCUIT_WINDOW_MS;
    while (this.samples.length > 0 && (this.samples[0]?.atMs ?? 0) < cutoff) {
      this.samples.shift();
    }
  }
}

@Injectable()
export class ProviderCircuitBreakerRegistry {
  private readonly breakers = new Map<PolicyProvider, ProviderCircuitBreaker>();
  private readonly clock: AdapterClock;
  private readonly logger: PlatformLogger | undefined;

  constructor(
    @Optional() @Inject(ADAPTER_CLOCK) clock?: AdapterClock,
    @Optional() logger?: PlatformLogger,
  ) {
    this.clock = clock ?? new SystemAdapterClock();
    this.logger = logger;
  }

  get(provider: PolicyProvider): ProviderCircuitBreaker {
    const existing = this.breakers.get(provider);
    if (existing !== undefined) {
      return existing;
    }
    const created = new ProviderCircuitBreaker(provider, this.clock, this.logger);
    this.breakers.set(provider, created);
    return created;
  }
}
