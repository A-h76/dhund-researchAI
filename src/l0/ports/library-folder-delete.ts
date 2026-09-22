export interface FolderNode {
  readonly id: string;
  readonly parentFolderId: string | null;
  readonly deletedAt: Date | null;
}

export interface FilingNode {
  readonly id: string;
  readonly folderId: string | null;
  readonly documentId: string | null;
  readonly externalRecordId: string | null;
  readonly deletedAt: Date | null;
}

export function descendantFolderIds(
  folders: readonly FolderNode[],
  rootId: string,
): readonly string[] {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.deletedAt !== null || folder.parentFolderId === null) {
      continue;
    }
    const list = children.get(folder.parentFolderId) ?? [];
    list.push(folder.id);
    children.set(folder.parentFolderId, list);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
    const next = children.get(id);
    if (next !== undefined) {
      stack.push(...next);
    }
  }
  return out;
}

/**
 * Filings in removed folders move to root. A filing that would duplicate an
 * existing root target is tombstoned; the document or external record is not.
 */
export function filingMoves(
  items: readonly FilingNode[],
  removedFolderIds: ReadonlySet<string>,
): { readonly root: readonly string[]; readonly tombstone: readonly string[] } {
  const rootDocs = new Set<string>();
  const rootRecords = new Set<string>();
  for (const item of items) {
    if (item.deletedAt !== null || item.folderId !== null) {
      continue;
    }
    if (item.documentId !== null) {
      rootDocs.add(item.documentId);
    }
    if (item.externalRecordId !== null) {
      rootRecords.add(item.externalRecordId);
    }
  }

  const root: string[] = [];
  const tombstone: string[] = [];
  for (const item of items) {
    if (
      item.deletedAt !== null ||
      item.folderId === null ||
      !removedFolderIds.has(item.folderId)
    ) {
      continue;
    }
    const docClash = item.documentId !== null && rootDocs.has(item.documentId);
    const recordClash =
      item.externalRecordId !== null && rootRecords.has(item.externalRecordId);
    if (docClash || recordClash) {
      tombstone.push(item.id);
      continue;
    }
    root.push(item.id);
    if (item.documentId !== null) {
      rootDocs.add(item.documentId);
    }
    if (item.externalRecordId !== null) {
      rootRecords.add(item.externalRecordId);
    }
  }
  return { root, tombstone };
}
