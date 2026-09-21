import { deriveJobId } from '../../src/platform/queues/deterministic-job-id';
import { buildDlqEntry, sanitizeForDlq } from '../../src/platform/queues/dlq-sanitize';
import { getQueuePolicy } from '../../src/platform/queues/queue-registry';
import { SYNTHESIS_PROMPT_VERSION } from '../../src/evidence/synthesis.constants';
import { RESEARCH_RUN_STEP_TYPES } from '../../src/orchestration/presets/research-run-dag';

describe('DHB-69 synthesis queue + step contracts', () => {
  it('retries 3× with natural key (runId, claimId, promptVersion)', () => {
    const policy = getQueuePolicy('synthesis');
    expect(policy.attempts).toEqual({ kind: 'fixed', attempts: 3 });
    expect(policy.naturalKeyFields).toEqual(['runId', 'claimId', 'promptVersion']);
    expect(policy.r1Processor).toBe(true);
  });

  it('derives a deterministic jobId for synthesis payloads', () => {
    const payload = {
      orgId: 'org-1',
      projectId: 'proj-1',
      correlationId: 'cor-1',
      runId: 'run-1',
      claimId: 'claim-1',
      promptVersion: SYNTHESIS_PROMPT_VERSION,
    };
    expect(deriveJobId('synthesis', payload)).toBe(
      deriveJobId('synthesis', { ...payload, correlationId: 'cor-other' }),
    );
  });

  it('DLQ entries contain ids and error text only — no evidence or prompt content', () => {
    const entry = buildDlqEntry({
      originalJobId: 'job-1',
      queue: 'synthesis',
      orgId: 'org-1',
      projectId: 'proj-1',
      correlationId: 'cor-1',
      naturalKey: {
        runId: 'run-1',
        claimId: 'claim-1',
        promptVersion: SYNTHESIS_PROMPT_VERSION,
      },
      errorMessage: 'Gateway synthesis execution failed',
      failedAt: '2026-09-22T00:00:00.000Z',
      attemptCount: 3,
    });

    const poisoned = {
      ...entry,
      documentContent: 'full paper text',
      prompt: 'system prompt',
      evidenceSummaries: ['secret quote'],
    };
    const sanitized = sanitizeForDlq(poisoned) as Record<string, unknown>;
    expect(sanitized.documentContent).toBeUndefined();
    expect(sanitized.prompt).toBeUndefined();
    expect(sanitized.evidenceSummaries).toBeUndefined();
    expect(sanitized.errorMessage).toBe('Gateway synthesis execution failed');
    expect(JSON.stringify(sanitized)).not.toContain('full paper text');
  });

  it('exposes synthesis as a coordinator run step type', () => {
    expect(RESEARCH_RUN_STEP_TYPES).toContain('synthesis');
  });
});
