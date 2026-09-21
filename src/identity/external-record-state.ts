/**
 * ExternalRecord lifecycle (Phase 7 §10 / DHB-71).
 * Soft lifecycle over deleted_at + stale_at; snapshots remain append-only.
 */
export type ExternalRecordLifecycle = 'active' | 'stale' | 'deleted';

export const EXTERNAL_RECORD_TRANSITIONS: Readonly<
  Record<ExternalRecordLifecycle, readonly ExternalRecordLifecycle[]>
> = {
  active: ['stale', 'deleted'],
  stale: ['active', 'deleted'],
  deleted: [],
};

export function canTransitionExternalRecord(
  from: ExternalRecordLifecycle,
  to: ExternalRecordLifecycle,
): boolean {
  if (from === to) {
    return true;
  }
  return EXTERNAL_RECORD_TRANSITIONS[from].includes(to);
}

export function lifecycleOf(record: {
  readonly deletedAt: Date | null;
  readonly staleAt: Date | null;
}): ExternalRecordLifecycle {
  if (record.deletedAt !== null) {
    return 'deleted';
  }
  if (record.staleAt !== null) {
    return 'stale';
  }
  return 'active';
}

export class ExternalRecordTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Forbidden external_record transition ${from} -> ${to}`);
    this.name = 'ExternalRecordTransitionError';
  }
}
