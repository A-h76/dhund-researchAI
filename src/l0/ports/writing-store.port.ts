export const WRITING_STORE = Symbol('WRITING_STORE');

export interface StoredWriting {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly currentVersionId: string | null;
  readonly deletedAt: Date | null;
}

export interface StoredWritingVersion {
  readonly id: string;
  readonly writingId: string;
  readonly versionNo: number;
  readonly contentRef: string;
  readonly createdBy: string;
}

export interface StoredWritingBinding {
  readonly id: string;
  readonly writingId: string;
  readonly writingVersionId: string;
  readonly projectId: string;
  readonly sentenceHash: string;
  readonly evidenceId: string;
  readonly strength: string;
}

export interface WritingEvidenceLink {
  readonly id: string;
  readonly projectId: string;
  readonly supersededById: string | null;
}

export interface WritingStore {
  insertWriting(input: {
    id: string;
    projectId: string;
    title: string;
    createdBy: string;
  }): Promise<StoredWriting>;
  findWriting(writingId: string): Promise<StoredWriting | null>;
  insertVersion(input: {
    id: string;
    writingId: string;
    versionNo: number;
    contentRef: string;
    createdBy: string;
  }): Promise<StoredWritingVersion>;
  listVersions(writingId: string): Promise<readonly StoredWritingVersion[]>;
  insertBinding(input: StoredWritingBinding): Promise<StoredWritingBinding>;
  listBindings(writingVersionId: string): Promise<readonly StoredWritingBinding[]>;
  findEvidence(evidenceId: string): Promise<WritingEvidenceLink | null>;
  messageBindingExists(projectId: string, evidenceId: string): Promise<boolean>;
}
