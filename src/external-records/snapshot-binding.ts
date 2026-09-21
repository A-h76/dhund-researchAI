/**
 * Evidence binding stability (DHB-71 AC): evidence extracted from snapshot n
 * still resolves to snapshot n after n+1 exists.
 */

export interface SnapshotBoundLocator {
  readonly externalRecordSnapshotId: string;
  readonly [key: string]: unknown;
}

export function bindEvidenceToSnapshot(
  locator: Readonly<Record<string, unknown>>,
  snapshotId: string,
): SnapshotBoundLocator {
  return {
    ...locator,
    externalRecordSnapshotId: snapshotId,
  };
}

export function resolveBoundSnapshotId(
  locator: Readonly<Record<string, unknown>>,
): string | null {
  const id = locator.externalRecordSnapshotId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Resolve the snapshot referenced by evidence — never "latest".
 * Returns null when the locator has no binding or the snapshot is missing.
 */
export async function resolveEvidenceSnapshot<T>(
  locator: Readonly<Record<string, unknown>>,
  loadById: (id: string) => Promise<T | null>,
): Promise<T | null> {
  const snapshotId = resolveBoundSnapshotId(locator);
  if (snapshotId === null) {
    return null;
  }
  return loadById(snapshotId);
}
