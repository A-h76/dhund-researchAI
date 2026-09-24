import { ProviderCircuitBreakerRegistry } from '../../src/ai/adapters/circuit-breaker';
import type { AdapterClock } from '../../src/ai/adapters/clock';
import { AlertingService } from '../../src/platform/observability/alerting.service';
import {
  ERROR_RATE_SPIKE_MIN_SAMPLES,
  MetricsSurface,
} from '../../src/platform/observability/metrics-surface';
import type { PlatformLogger } from '../../src/platform/logging';
import { QueueMetricsService } from '../../src/platform/queues/queue-metrics';
import type { QueueService } from '../../src/l0/ports';

function quietLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

class FakeClock implements AdapterClock {
  now(): number {
    return 0;
  }

  async sleep(): Promise<void> {
    return undefined;
  }
}

describe('DHB-18 alerting', () => {
  it('fires when DLQ depth is greater than zero', async () => {
    const logger = quietLogger();
    const alerting = new AlertingService(logger);
    const surface = new MetricsSurface(alerting);
    const queues = {
      getQueueDepth: async (name: string) =>
        name.endsWith('-dlq')
          ? { waiting: 2, active: 0, failed: 0, delayed: 0 }
          : { waiting: 0, active: 0, failed: 0, delayed: 0 },
    } as unknown as QueueService;
    const metrics = new QueueMetricsService(queues, logger, surface);

    await metrics.snapshot('embed');

    expect(alerting.has('dlq_depth')).toBe(true);
    expect(surface.snapshot().some((sample) => sample.name === 'dlq' && sample.value === 2)).toBe(
      true,
    );
  });

  it('fires when a circuit breaker opens', () => {
    const logger = quietLogger();
    const alerting = new AlertingService(logger);
    const registry = new ProviderCircuitBreakerRegistry(new FakeClock(), logger, alerting);
    const breaker = registry.get('openai');

    for (let i = 0; i < 5; i += 1) {
      breaker.allowRequest();
      breaker.recordFailure();
    }

    expect(breaker.getState()).toBe('open');
    expect(alerting.has('circuit_open')).toBe(true);
    expect(JSON.stringify(alerting.snapshot())).not.toContain('openai');
  });

  it('fires on an error-rate spike and on a slow query past 500ms', () => {
    const logger = quietLogger();
    const alerting = new AlertingService(logger);
    const surface = new MetricsSurface(alerting);

    for (let i = 0; i < ERROR_RATE_SPIKE_MIN_SAMPLES; i += 1) {
      surface.recordApi({ routeClass: 'auth', latencyMs: 10, error: true });
    }
    surface.recordSlowQuery(501);
    surface.recordBrokenProvenance(1);

    expect(alerting.has('error_rate_spike')).toBe(true);
    expect(alerting.has('slow_query')).toBe(true);
    expect(alerting.has('broken_provenance')).toBe(true);
  });
});
