import { deriveJobId } from '../../src/platform/queues/deterministic-job-id';
import { buildDlqEntry, sanitizeForDlq } from '../../src/platform/queues/dlq-sanitize';
import { getQueuePolicy } from '../../src/platform/queues/queue-registry';

describe('DHB-68 extraction-cell queue contracts', () => {
  it('retries 3× with natural key (extractionRunId, documentId, columnKey)', () => {
    const policy = getQueuePolicy('extraction-cell');
    expect(policy.attempts).toEqual({ kind: 'fixed', attempts: 3 });
    expect(policy.naturalKeyFields).toEqual([
      'extractionRunId',
      'documentId',
      'columnKey',
    ]);
  });

  it('derives a deterministic jobId — same cell dispatched twice executes once', () => {
    const payload = {
      orgId: 'org-1',
      projectId: 'proj-1',
      correlationId: 'cor-1',
      runId: 'run-1',
      extractionRunId: 'er-1',
      documentId: 'doc-1',
      columnKey: 'dose',
    };
    expect(deriveJobId('extraction-cell', payload)).toBe(
      deriveJobId('extraction-cell', {
        ...payload,
        correlationId: 'cor-other',
        runId: 'run-other',
      }),
    );
  });

  it('DLQ entries contain ids and error text only — no document or prompt content', () => {
    const entry = buildDlqEntry({
      originalJobId: 'job-1',
      queue: 'extraction-cell',
      orgId: 'org-1',
      projectId: 'proj-1',
      correlationId: 'cor-1',
      naturalKey: {
        extractionRunId: 'er-1',
        documentId: 'doc-1',
        columnKey: 'dose',
      },
      errorMessage: 'document_not_ready',
      failedAt: '2026-09-19T00:00:00.000Z',
      attemptCount: 3,
    });

    const poisoned = {
      ...entry,
      documentContent: 'full paper text',
      prompt: 'system prompt',
      documentText: 'quoted body',
    };
    const sanitized = sanitizeForDlq(poisoned) as Record<string, unknown>;
    expect(sanitized.documentContent).toBeUndefined();
    expect(sanitized.prompt).toBeUndefined();
    expect(sanitized.documentText).toBeUndefined();
    expect(sanitized.errorMessage).toBe('document_not_ready');
    expect(JSON.stringify(sanitized)).not.toContain('full paper text');
    expect(JSON.stringify(entry)).not.toContain('full paper text');
  });
});
