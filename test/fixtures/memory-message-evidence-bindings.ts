import type {
  MessageEvidenceBindingInsert,
  MessageEvidenceBindingStore,
  StoredMessageEvidenceBinding,
} from '../../src/l0/ports/message-evidence-binding.port';
import type { ProjectScope } from '../../src/l0/ports/scoped-store.port';
import { L0OperationError } from '../../src/l0/ports/errors';

export class MemoryMessageEvidenceBindings implements MessageEvidenceBindingStore {
  readonly rows: StoredMessageEvidenceBinding[] = [];
  readonly liveEvidence = new Set<string>();

  seedEvidence(projectId: string, evidenceId: string): void {
    this.liveEvidence.add(`${projectId}:${evidenceId}`);
  }

  async insertMany(
    scope: ProjectScope,
    rows: readonly MessageEvidenceBindingInsert[],
  ): Promise<readonly StoredMessageEvidenceBinding[]> {
    for (const row of rows) {
      if (row.projectId !== scope.projectId) {
        throw new L0OperationError('project scope mismatch');
      }
      if (!this.liveEvidence.has(`${scope.projectId}:${row.evidenceId}`)) {
        throw new L0OperationError('evidence missing or cross-project');
      }
      this.rows.push({ ...row });
    }
    return rows.map((row) => ({ ...row }));
  }

  async listForMessage(
    scope: ProjectScope,
    messageId: string,
  ): Promise<readonly StoredMessageEvidenceBinding[]> {
    return this.rows.filter(
      (row) => row.messageId === messageId && row.projectId === scope.projectId,
    );
  }
}
