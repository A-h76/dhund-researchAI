import { deriveJobId } from '../../src/platform/queues/deterministic-job-id';
import { buildDlqEntry, sanitizeForDlq } from '../../src/platform/queues/dlq-sanitize';
import { EVIDENCE_EXTRACT_STEP_TYPE } from '../../src/evidence/extract.constants';

describe('DHB-59 queue contracts', () => {
  it('derives a deterministic jobId for evidence-extract research-run-step payloads', () => {
    const payload = {
      orgId: 'org-1',
      projectId: 'proj-1',
      correlationId: 'cor-1',
      runId: 'run-1',
      stepId: 'step-1',
      stepType: EVIDENCE_EXTRACT_STEP_TYPE,
      inputFingerprint: 'fp-1',
      stepVersion: 'v1',
      sourceId: 'src-1',
      documentVersionId: 'dv-1',
    };
    const first = deriveJobId('research-run-step', payload);
    const second = deriveJobId('research-run-step', {
      ...payload,
      correlationId: 'cor-other',
      sourceId: 'src-other',
    });
    expect(first).toBe(second);
  });

  it('derives a deterministic jobId for stance payloads', () => {
    const payload = {
      orgId: 'org-1',
      projectId: 'proj-1',
      correlationId: 'cor-1',
      runId: 'run-1',
      evidenceId: 'ev-1',
      claimId: 'claim-1',
    };
    expect(deriveJobId('stance', payload)).toBe(
      deriveJobId('stance', { ...payload, correlationId: 'cor-2', claimId: 'claim-2' }),
    );
  });

  it('DLQ entries contain ids and error text only — no document or prompt content', () => {
    const entry = buildDlqEntry({
      originalJobId: 'job-1',
      queue: 'stance',
      orgId: 'org-1',
      projectId: 'proj-1',
      correlationId: 'cor-1',
      naturalKey: { runId: 'run-1', evidenceId: 'ev-1' },
      errorMessage: 'Gateway stance execution failed',
      failedAt: '2026-09-10T00:00:00.000Z',
      attemptCount: 3,
    });

    const poisoned = {
      ...entry,
      documentContent: 'full paper text',
      documentText: 'quoted body',
      prompt: 'system prompt',
      claim: 'the claim under evaluation',
      evidenceText: 'evidence quote',
    };

    const sanitized = sanitizeForDlq(poisoned) as Record<string, unknown>;
    expect(sanitized.documentContent).toBeUndefined();
    expect(sanitized.documentText).toBeUndefined();
    expect(sanitized.prompt).toBeUndefined();
    expect(sanitized.claim).toBeUndefined();
    expect(sanitized.evidenceText).toBeUndefined();
    expect(sanitized.errorMessage).toBe('Gateway stance execution failed');
    expect(sanitized.orgId).toBe('org-1');
    expect(JSON.stringify(sanitized)).not.toContain('full paper text');
    expect(JSON.stringify(sanitized)).not.toContain('system prompt');
  });
});
