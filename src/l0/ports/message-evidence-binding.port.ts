import type { ProjectScope } from './scoped-store.port';

export interface MessageEvidenceBindingInsert {
  readonly id: string;
  readonly messageId: string;
  readonly evidenceId: string;
  readonly projectId: string;
}

export interface StoredMessageEvidenceBinding {
  readonly id: string;
  readonly messageId: string;
  readonly evidenceId: string;
  readonly projectId: string;
}

/**
 * Message↔evidence bindings (DHB-62). Disjoint from writing_sentence_bindings.
 * Writes reject evidence that is not live in the same project.
 */
export interface MessageEvidenceBindingStore {
  insertMany(
    scope: ProjectScope,
    rows: readonly MessageEvidenceBindingInsert[],
  ): Promise<readonly StoredMessageEvidenceBinding[]>;
  listForMessage(
    scope: ProjectScope,
    messageId: string,
  ): Promise<readonly StoredMessageEvidenceBinding[]>;
}
