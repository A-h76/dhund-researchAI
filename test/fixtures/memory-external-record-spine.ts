import type {
  ExternalRecordRow,
  ExternalRecordSnapshotRow,
  ExternalRecordSpineStore,
} from '../../src/l0/ports/external-record-spine.port';

export class MemoryExternalRecordSpineStore implements ExternalRecordSpineStore {
  records = new Map<string, ExternalRecordRow>();
  snapshots: ExternalRecordSnapshotRow[] = [];
  sessions = new Map<
    string,
    {
      id: string;
      projectId: string;
      source: string;
      initiatedBy: string;
      state: string;
      itemsTotal: number | null;
      itemsAdmitted: number;
      itemsRejected: number;
      idempotencyKey: string;
    }
  >();

  async getRecord(id: string) {
    return this.records.get(id) ?? null;
  }

  async createRecord(
    input: Omit<ExternalRecordRow, 'linkedCanonicalWorkId' | 'lastCheckedAt' | 'staleAt' | 'deletedAt'> & {
      linkedCanonicalWorkId?: string | null;
    },
  ) {
    const row: ExternalRecordRow = {
      id: input.id,
      projectId: input.projectId,
      connectorId: input.connectorId,
      externalId: input.externalId,
      type: input.type,
      linkedCanonicalWorkId: input.linkedCanonicalWorkId ?? null,
      rightsSnapshotId: input.rightsSnapshotId,
      lastCheckedAt: null,
      staleAt: null,
      deletedAt: null,
    };
    this.records.set(row.id, row);
    return row;
  }

  async getSnapshot(id: string) {
    return this.snapshots.find((row) => row.id === id) ?? null;
  }

  async getLatestSnapshot(externalRecordId: string) {
    const rows = this.snapshots
      .filter((row) => row.externalRecordId === externalRecordId)
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    return rows[0] ?? null;
  }

  async appendSnapshot(input: ExternalRecordSnapshotRow) {
    this.snapshots.push(input);
    const record = this.records.get(input.externalRecordId);
    if (record !== undefined) {
      this.records.set(input.externalRecordId, {
        ...record,
        lastCheckedAt: input.capturedAt,
        staleAt: null,
      });
    }
    return input;
  }

  async markChecked(externalRecordId: string, checkedAt: Date) {
    const record = this.records.get(externalRecordId);
    if (record === undefined) {
      throw new Error('missing');
    }
    const next = { ...record, lastCheckedAt: checkedAt, staleAt: null };
    this.records.set(externalRecordId, next);
    return next;
  }

  async markStale(externalRecordId: string, staleAt: Date) {
    const record = this.records.get(externalRecordId);
    if (record === undefined) {
      throw new Error('missing');
    }
    const next = { ...record, staleAt };
    this.records.set(externalRecordId, next);
    return next;
  }

  async softDelete(externalRecordId: string, deletedAt: Date) {
    const record = this.records.get(externalRecordId);
    if (record === undefined) {
      throw new Error('missing');
    }
    const next = { ...record, deletedAt };
    this.records.set(externalRecordId, next);
    return next;
  }

  async getImportSession(id: string) {
    return this.sessions.get(id) ?? null;
  }

  async updateImportSession(input: {
    readonly id: string;
    readonly state: string;
    readonly itemsTotal?: number | null;
    readonly itemsAdmitted?: number;
    readonly itemsRejected?: number;
    readonly errors?: unknown;
    readonly terminalAt?: Date | null;
  }) {
    const session = this.sessions.get(input.id);
    if (session === undefined) {
      throw new Error('missing session');
    }
    this.sessions.set(input.id, {
      ...session,
      state: input.state,
      ...(input.itemsTotal !== undefined ? { itemsTotal: input.itemsTotal } : {}),
      ...(input.itemsAdmitted !== undefined ? { itemsAdmitted: input.itemsAdmitted } : {}),
      ...(input.itemsRejected !== undefined ? { itemsRejected: input.itemsRejected } : {}),
    });
  }
}
