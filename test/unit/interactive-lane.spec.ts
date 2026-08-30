import { InteractiveLaneService } from '../../src/platform/concurrency/interactive-lane.service';
import { ConcurrencyMetrics } from '../../src/platform/concurrency/concurrency-metrics';
import { INTERACTIVE_LATENCY_BUDGET_MS } from '../../src/platform/concurrency/concurrency-gate.config';

describe('interactive lane fairness (DHB-42)', () => {
  it('keeps interactive latency under budget while batch is saturated', async () => {
    const metrics = new ConcurrencyMetrics();
    const lane = new InteractiveLaneService(metrics);
    lane.markBatchSaturated(true);

    const result = await lane.runInteractiveProbe(async () => {
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(metrics.snapshot().interactiveLatencyMs).toBeLessThanOrEqual(
      INTERACTIVE_LATENCY_BUDGET_MS,
    );
  });

  it('asserts batch saturation does not starve interactive work', async () => {
    const lane = new InteractiveLaneService(new ConcurrencyMetrics());
    lane.markBatchSaturated(true);

    await expect(lane.assertBatchDoesNotStarveInteractive()).resolves.toBeUndefined();
  });
});
