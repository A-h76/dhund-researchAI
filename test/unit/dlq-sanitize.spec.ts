import { buildDlqEntry, sanitizeForDlq } from '../../src/platform/queues/dlq-sanitize';

describe('DLQ sanitization (DHB-40)', () => {
  it('removes document, evidence, and prompt text from DLQ entries', () => {
    const entry = buildDlqEntry({
      originalJobId: 'extract:abc',
      queue: 'extract',
      orgId: 'org-1',
      projectId: 'proj-1',
      correlationId: 'cor-1',
      naturalKey: { documentVersionId: 'dv-1' },
      errorMessage: 'extraction failed',
      failedAt: '2026-08-30T00:00:00.000Z',
      attemptCount: 5,
    });

    const poisoned = sanitizeForDlq({
      ...entry,
      documentText: 'full document body',
      evidenceText: 'quoted evidence',
      prompt: 'system prompt',
      promptText: 'user prompt',
      password: 'secret',
      token: 'tok',
    }) as Record<string, unknown>;

    expect(poisoned.documentText).toBeUndefined();
    expect(poisoned.evidenceText).toBeUndefined();
    expect(poisoned.prompt).toBeUndefined();
    expect(poisoned.promptText).toBeUndefined();
    expect(poisoned.password).toBeUndefined();
    expect(poisoned.token).toBeUndefined();
    expect(poisoned.orgId).toBe('org-1');
    expect(poisoned.errorMessage).toBe('extraction failed');
  });
});
