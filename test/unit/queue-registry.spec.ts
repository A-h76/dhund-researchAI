import {
  dlqNameFor,
  hasR1Processor,
  listQueuePolicies,
  QUEUE_NAMES,
  QUEUE_REGISTRY,
  R1_FORWARD_COMPAT_QUEUES,
  resolveAttempts,
} from '../../src/platform/queues';

describe('queue registry (DHB-40)', () => {
  it('defines exactly 25 queues with exact Phase 4 §9 names', () => {
    expect(QUEUE_NAMES).toHaveLength(25);
    expect([...QUEUE_NAMES].sort()).toEqual([...QUEUE_NAMES].sort());
    expect(Object.keys(QUEUE_REGISTRY)).toHaveLength(25);
  });

  it('does not register interactive-lane queues', () => {
    const names = QUEUE_NAMES as readonly string[];
    expect(names).not.toContain('chat');
    expect(names).not.toContain('autocomplete');
    expect(names).not.toContain('rerank');
  });

  it('marks screening and derivation as forward-compatible without R1 processors', () => {
    expect(R1_FORWARD_COMPAT_QUEUES).toEqual(['screening', 'derivation']);
    expect(hasR1Processor('screening')).toBe(false);
    expect(hasR1Processor('derivation')).toBe(false);
    expect(QUEUE_REGISTRY.screening.r1Processor).toBe(false);
    expect(QUEUE_REGISTRY.derivation.r1Processor).toBe(false);
  });

  it('names DLQs as <queue>-dlq for every queue (BullMQ-safe, no colons)', () => {
    for (const policy of listQueuePolicies()) {
      expect(policy.dlqName).toBe(dlqNameFor(policy.name));
      expect(policy.dlqName).not.toContain(':');
    }
  });

  it('matches authoritative retry counts', () => {
    const fixed = (name: (typeof QUEUE_NAMES)[number], attempts: number) => {
      expect(resolveAttempts(QUEUE_REGISTRY[name])).toBe(attempts);
    };

    fixed('extract', 5);
    fixed('chunk', 5);
    fixed('embed', 5);
    fixed('connector-fetch', 5);
    fixed('billing-sync', 5);
    fixed('ocr', 3);
    fixed('orphan-sweep', 1);
    fixed('reaper', 1);
    fixed('billing-reconcile', 1);

    expect(QUEUE_REGISTRY['research-run-tick'].attempts).toEqual({ kind: 'infinite' });
    expect(QUEUE_REGISTRY['research-run-tick'].naturalKeyFields).toEqual(['runId']);
    expect(QUEUE_REGISTRY['research-run-tick'].requiredPayloadFields).toEqual([
      'orgId',
      'correlationId',
      'projectId',
      'runId',
    ]);
    expect(QUEUE_REGISTRY['outbox-relay'].attempts).toEqual({ kind: 'infinite' });
    expect(QUEUE_REGISTRY['research-run-step'].attempts).toEqual({
      kind: 'per-step-type',
      defaultAttempts: 3,
    });
    expect(resolveAttempts(QUEUE_REGISTRY['research-run-step'])).toBe(3);
    expect(resolveAttempts(QUEUE_REGISTRY['research-run-tick'])).toBeUndefined();
  });
});
