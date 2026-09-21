import { Inject, Injectable, Optional } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import {
  CONNECTOR_CLOCK,
  SystemConnectorClock,
  type ConnectorClock,
} from './connector-clock';

export const CONNECTOR_CIRCUIT_CONSECUTIVE_FAILURES = 5;
export const CONNECTOR_CIRCUIT_FAILURE_RATE_THRESHOLD = 0.5;
export const CONNECTOR_CIRCUIT_WINDOW_MS = 60_000;
export const CONNECTOR_CIRCUIT_HALF_OPEN_AFTER_MS = 30_000;
export const CONNECTOR_CIRCUIT_MIN_SAMPLES_FOR_RATE = 6;

export type ConnectorCircuitState = 'closed' | 'open' | 'half_open';

interface OutcomeSample {
  readonly atMs: number;
  readonly success: boolean;
}

/**
 * Per-connector circuit breaker. Intentionally separate from AI provider breakers
 * so an open connector never affects another connector or any AI provider.
 */
export class ConnectorCircuitBreaker {
  private state: ConnectorCircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAtMs = 0;
  private probeInFlight = false;
  private readonly samples: OutcomeSample[] = [];

  constructor(
    readonly connectorId: string,
    private readonly clock: ConnectorClock,
    private readonly logger?: PlatformLogger,
  ) {}

  getState(): ConnectorCircuitState {
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
      this.consecutiveFailures >= CONNECTOR_CIRCUIT_CONSECUTIVE_FAILURES ||
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
    if (this.clock.now() - this.openedAtMs >= CONNECTOR_CIRCUIT_HALF_OPEN_AFTER_MS) {
      this.state = 'half_open';
      this.probeInFlight = false;
    }
  }

  private failureRateExceeded(): boolean {
    const cutoff = this.clock.now() - CONNECTOR_CIRCUIT_WINDOW_MS;
    const window = this.samples.filter((sample) => sample.atMs >= cutoff);
    if (window.length < CONNECTOR_CIRCUIT_MIN_SAMPLES_FOR_RATE) {
      return false;
    }
    const failures = window.filter((sample) => !sample.success).length;
    return failures / window.length > CONNECTOR_CIRCUIT_FAILURE_RATE_THRESHOLD;
  }

  private open(): void {
    const wasOpen = this.state === 'open';
    this.state = 'open';
    this.openedAtMs = this.clock.now();
    this.probeInFlight = false;
    if (!wasOpen) {
      this.logger?.info({
        module: 'connectors',
        message: 'connector.circuit.opened',
        connectorId: this.connectorId,
        consecutiveFailures: this.consecutiveFailures,
      });
    }
  }

  private pushSample(success: boolean): void {
    const now = this.clock.now();
    this.samples.push({ atMs: now, success });
    const cutoff = now - CONNECTOR_CIRCUIT_WINDOW_MS;
    while (this.samples.length > 0 && (this.samples[0]?.atMs ?? 0) < cutoff) {
      this.samples.shift();
    }
  }
}

@Injectable()
export class ConnectorCircuitBreakerRegistry {
  private readonly breakers = new Map<string, ConnectorCircuitBreaker>();
  private readonly clock: ConnectorClock;
  private readonly logger: PlatformLogger | undefined;

  constructor(
    @Optional() @Inject(CONNECTOR_CLOCK) clock?: ConnectorClock,
    @Optional() logger?: PlatformLogger,
  ) {
    this.clock = clock ?? new SystemConnectorClock();
    this.logger = logger;
  }

  get(connectorId: string): ConnectorCircuitBreaker {
    const existing = this.breakers.get(connectorId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new ConnectorCircuitBreaker(connectorId, this.clock, this.logger);
    this.breakers.set(connectorId, created);
    return created;
  }
}
