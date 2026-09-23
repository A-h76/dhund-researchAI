import type {
  StoredWriting,
  StoredWritingBinding,
  StoredWritingVersion,
  WritingEvidenceLink,
  WritingStore,
} from '../../src/l0/ports/writing-store.port';
import { L0OperationError } from '../../src/l0/ports/errors';
import { BindingOccupancy, bindingKey } from './binding-occupancy';

export class MemoryWritingStore implements WritingStore {
  readonly writings = new Map<string, StoredWriting>();
  readonly versions: StoredWritingVersion[] = [];
  readonly bindings: StoredWritingBinding[] = [];
  readonly evidence = new Map<string, WritingEvidenceLink>();
  readonly occupancy: BindingOccupancy;

  constructor(occupancy?: BindingOccupancy) {
    this.occupancy = occupancy ?? new BindingOccupancy();
  }

  seedEvidence(projectId: string, evidenceId: string): void {
    this.evidence.set(evidenceId, {
      id: evidenceId,
      projectId,
      supersededById: null,
    });
  }

  supersede(evidenceId: string, successorId: string): void {
    const current = this.evidence.get(evidenceId);
    if (current === undefined) {
      throw new Error('evidence missing');
    }
    this.evidence.set(evidenceId, { ...current, supersededById: successorId });
    this.evidence.set(successorId, {
      id: successorId,
      projectId: current.projectId,
      supersededById: null,
    });
  }

  async insertWriting(input: {
    id: string;
    projectId: string;
    title: string;
    createdBy: string;
  }): Promise<StoredWriting> {
    const row: StoredWriting = {
      id: input.id,
      projectId: input.projectId,
      title: input.title,
      currentVersionId: null,
      deletedAt: null,
    };
    this.writings.set(row.id, row);
    return row;
  }

  async findWriting(writingId: string): Promise<StoredWriting | null> {
    return this.writings.get(writingId) ?? null;
  }

  async insertVersion(input: {
    id: string;
    writingId: string;
    versionNo: number;
    contentRef: string;
    createdBy: string;
  }): Promise<StoredWritingVersion> {
    const writing = this.writings.get(input.writingId);
    if (writing === undefined) {
      throw new L0OperationError('Writing version insert failed');
    }
    const row: StoredWritingVersion = { ...input };
    this.versions.push(row);
    this.writings.set(writing.id, { ...writing, currentVersionId: row.id });
    return row;
  }

  async listVersions(writingId: string): Promise<readonly StoredWritingVersion[]> {
    return this.versions.filter((row) => row.writingId === writingId);
  }

  async insertBinding(input: StoredWritingBinding): Promise<StoredWritingBinding> {
    const key = bindingKey(input.projectId, input.evidenceId);
    if (this.occupancy.message.has(key)) {
      throw new L0OperationError('Writing and message evidence bindings are disjoint');
    }
    this.occupancy.writing.add(key);
    this.bindings.push(input);
    return input;
  }

  async listBindings(writingVersionId: string): Promise<readonly StoredWritingBinding[]> {
    return this.bindings.filter((row) => row.writingVersionId === writingVersionId);
  }

  async findEvidence(evidenceId: string): Promise<WritingEvidenceLink | null> {
    return this.evidence.get(evidenceId) ?? null;
  }

  async messageBindingExists(projectId: string, evidenceId: string): Promise<boolean> {
    return this.occupancy.message.has(bindingKey(projectId, evidenceId));
  }
}
