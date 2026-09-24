import { MERGE_APPROVED_ACTION, MergeApprovalService } from '../../src/retrieval/merge-approval.service';
import type { AuditEventAppendInput, AuditEventPort } from '../../src/l0/ports';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { runWithCorrelationIdAsync } from '../../src/platform/logging/correlation-context';

class MemoryAudit implements AuditEventPort {
  readonly rows: AuditEventAppendInput[] = [];

  async append(input: AuditEventAppendInput): Promise<void> {
    this.rows.push(input);
  }
}

describe('DHB-18 audited actions write one row', () => {
  it('records exactly one merge-approval row with correlationId, actor, target, and action', async () => {
    const audit = new MemoryAudit();
    const service = new MergeApprovalService(audit);
    const actorId = generateId();
    const mergeCandidateId = generateId();
    const correlationId = 'cor-merge';

    await runWithCorrelationIdAsync(correlationId, () =>
      service.approve({
        actorId,
        mergeCandidateId,
        orgId: generateId(),
      }),
    );

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actorType: 'user',
      actorId,
      action: MERGE_APPROVED_ACTION,
      correlationId,
      scope: { target: mergeCandidateId, actor: actorId },
    });
  });
});
