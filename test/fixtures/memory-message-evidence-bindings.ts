import type {
  MessageEvidenceBindingInsert,
  MessageEvidenceBindingStore,
  StoredMessageEvidenceBinding,
} from '../../src/l0/ports/message-evidence-binding.port';
import type { ProjectScope } from '../../src/l0/ports/scoped-store.port';
import { L0OperationError } from '../../src/l0/ports/errors';
import { BindingOccupancy, bindingKey } from './binding-occupancy';

export class MemoryMessageEvidenceBindings implements MessageEvidenceBindingStore {
  readonly rows: StoredMessageEvidenceBinding[] = [];
  readonly liveEvidence = new Set<string>();
  readonly occupancy: BindingOccupancy;

  constructor(occupancy?: BindingOccupancy) {
    this.occupancy = occupancy ?? new BindingOccupancy();
  }

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
      const key = bindingKey(scope.projectId, row.evidenceId);
      if (this.occupancy.writing.has(key)) {
        throw new L0OperationError('Writing and message evidence bindings are disjoint');
      }
      this.occupancy.message.add(key);
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
