import type { StoredBlock } from '../l0/ports/extract-store.port';

export interface EvidenceLocator {
  readonly blockId: string;
  readonly documentVersionId: string;
  readonly page: number;
}

export function locatorResolves(
  locator: EvidenceLocator,
  block: StoredBlock | null,
): boolean {
  return (
    block !== null &&
    block.id === locator.blockId &&
    block.documentVersionId === locator.documentVersionId &&
    block.page === locator.page
  );
}
