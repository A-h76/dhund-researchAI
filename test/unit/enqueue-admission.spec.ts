import {
  AdmissionRejectedError,
  EnqueueAdmissionService,
  GATE_ACQUIRE_TIMEOUT_MS,
  GATE_DEMOTION_DELAY_MS,
  InteractiveLaneService,
} from '../../src/platform/concurrency';
import { BatchConcurrencyGateService } from '../../src/platform/concurrency/batch-concurrency-gate.service';
import { ConcurrencyMetrics } from '../../src/platform/concurrency/concurrency-metrics';

describe('enqueue admission (DHB-42)', () => {
  it('rejects over-limit org work before enqueue', async () => {
    const gate = {
      getOrgInflight: jest.fn().mockResolvedValue(10),
      isOrgOverHardLimit: BatchConcurrencyGateService.prototype.isOrgOverHardLimit,
      tryAcquireImmediate: jest.fn(),
      release: jest.fn(),
      getGlobalInflight: jest.fn(),
    } as unknown as BatchConcurrencyGateService;

    const metrics = new ConcurrencyMetrics();
    const interactive = new InteractiveLaneService(metrics);
    const admission = new EnqueueAdmissionService(gate, interactive, metrics);

    await expect(
      admission.admitBeforeEnqueue({ orgId: 'org-heavy', queueName: 'extract' }),
    ).rejects.toBeInstanceOf(AdmissionRejectedError);
    expect(gate.tryAcquireImmediate).not.toHaveBeenCalled();
  });

  it('demotes to a delayed job after the 30s gate acquire timeout', async () => {
    jest.useFakeTimers();

    const gate = {
      getOrgInflight: jest.fn().mockResolvedValue(0),
      isOrgOverHardLimit: BatchConcurrencyGateService.prototype.isOrgOverHardLimit,
      tryAcquireImmediate: jest.fn().mockResolvedValue(null),
      release: jest.fn(),
      getGlobalInflight: jest.fn(),
    } as unknown as BatchConcurrencyGateService;

    const metrics = new ConcurrencyMetrics();
    const interactive = new InteractiveLaneService(metrics);
    const admission = new EnqueueAdmissionService(gate, interactive, metrics);

    const promise = admission.admitBeforeEnqueue({ orgId: 'org-wait', queueName: 'chunk' });
    await jest.advanceTimersByTimeAsync(GATE_ACQUIRE_TIMEOUT_MS + 100);
    const outcome = await promise;

    expect(outcome.kind).toBe('demoted');
    if (outcome.kind === 'demoted') {
      expect(outcome.delayMs).toBe(GATE_DEMOTION_DELAY_MS);
    }
    expect(metrics.snapshot().gateTimeoutCount).toBe(1);

    jest.useRealTimers();
  });
});
