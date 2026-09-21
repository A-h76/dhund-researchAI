/**
 * External Record spine (DHB-71 / R10).
 *
 * External Record ≠ Work Manifestation. Records are project-scoped native-identity
 * entities and are never forced under a Canonical Work.
 *
 * Refresh is append-only: new snapshots are inserted; UPDATE is rejected by trigger.
 */

export type ExternalRecordTypeValue = 'web_page' | 'zotero_item';

export interface ExternalRecordRow {
  readonly id: string;
  readonly projectId: string;
  readonly connectorId: string;
  readonly externalId: string;
  readonly type: ExternalRecordTypeValue;
  readonly linkedCanonicalWorkId: string | null;
  readonly rightsSnapshotId: string;
  readonly lastCheckedAt: Date | null;
  readonly staleAt: Date | null;
  readonly deletedAt: Date | null;
}

export interface ExternalRecordSnapshotRow {
  readonly id: string;
  readonly externalRecordId: string;
  readonly capturedAt: Date;
  readonly contentRef: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ExternalRecordSpineStore {
  getRecord(id: string): Promise<ExternalRecordRow | null>;

  createRecord(input: {
    readonly id: string;
    readonly projectId: string;
    readonly connectorId: string;
    readonly externalId: string;
    readonly type: ExternalRecordTypeValue;
    readonly rightsSnapshotId: string;
    readonly linkedCanonicalWorkId?: string | null;
  }): Promise<ExternalRecordRow>;

  getSnapshot(id: string): Promise<ExternalRecordSnapshotRow | null>;

  getLatestSnapshot(externalRecordId: string): Promise<ExternalRecordSnapshotRow | null>;

  appendSnapshot(input: {
    readonly id: string;
    readonly externalRecordId: string;
    readonly capturedAt: Date;
    readonly contentRef: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
  }): Promise<ExternalRecordSnapshotRow>;

  /** Unchanged payload: advance last_checked_at and clear stale_at; no new snapshot. */
  markChecked(externalRecordId: string, checkedAt: Date): Promise<ExternalRecordRow>;

  /** Failed refresh: keep serving prior snapshot; set stale_at. */
  markStale(externalRecordId: string, staleAt: Date): Promise<ExternalRecordRow>;

  softDelete(externalRecordId: string, deletedAt: Date): Promise<ExternalRecordRow>;

  getImportSession(id: string): Promise<{
    readonly id: string;
    readonly projectId: string;
    readonly source: string;
    readonly initiatedBy: string;
    readonly state: string;
    readonly itemsTotal: number | null;
    readonly itemsAdmitted: number;
    readonly itemsRejected: number;
    readonly idempotencyKey: string;
  } | null>;

  updateImportSession(input: {
    readonly id: string;
    readonly state: string;
    readonly itemsTotal?: number | null;
    readonly itemsAdmitted?: number;
    readonly itemsRejected?: number;
    readonly errors?: unknown;
    readonly terminalAt?: Date | null;
  }): Promise<void>;
}

export const EXTERNAL_RECORD_SPINE_STORE = Symbol('EXTERNAL_RECORD_SPINE_STORE');
