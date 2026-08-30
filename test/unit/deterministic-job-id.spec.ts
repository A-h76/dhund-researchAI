import { deriveJobId } from '../../src/platform/queues/deterministic-job-id';

describe('deterministic jobId (DHB-40)', () => {
  const billingPayload = {
    orgId: 'org-1',
    correlationId: 'cor-1',
    stripeEventId: 'evt_abc',
  };

  it('derives the same jobId for the same natural key', () => {
    const first = deriveJobId('billing-sync', billingPayload);
    const second = deriveJobId('billing-sync', billingPayload);
    expect(first).toBe(second);
    expect(first).toMatch(/^billing-sync:[a-f0-9]{64}$/);
  });

  it('derives different jobIds for different natural keys', () => {
    const first = deriveJobId('billing-sync', billingPayload);
    const second = deriveJobId('billing-sync', {
      ...billingPayload,
      stripeEventId: 'evt_xyz',
    });
    expect(first).not.toBe(second);
  });

  it('does not embed timestamps or randomness in the jobId', () => {
    const jobId = deriveJobId('billing-sync', billingPayload);
    expect(jobId).not.toMatch(/\d{13}/);
    expect(jobId.split(':')[1]).toHaveLength(64);
  });

  it('scopes jobId by queue name', () => {
    const billing = deriveJobId('billing-sync', billingPayload);
    const rollup = deriveJobId('usage-rollup', {
      orgId: 'org-1',
      correlationId: 'cor-1',
      period: '2026-08',
    });
    expect(billing).not.toBe(rollup);
  });
});
