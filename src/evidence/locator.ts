import { locatorResolves, type EvidenceLocator } from '../ingestion/extract.locator';
import type { StoredBlock } from '../l0/ports/extract-store.port';
import { isUuid } from '../platform/ids/uuid-v7';

export type { EvidenceLocator };

export type LocatorRejectionReason =
  | 'missing_locator'
  | 'unresolved_locator'
  | 'page_mismatch'
  | 'quote_mismatch'
  | 'cross_project_chunk'
  | 'body_grounded_without_chunk'
  | 'llm_without_execution'
  | 'metadata_masquerade'
  | 'forbidden_body';

export function isNonEmptyLocatorObject(
  raw: unknown,
): raw is Record<string, unknown> {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.keys(raw).length > 0
  );
}

export function parseStructureLocator(raw: unknown): EvidenceLocator | null {
  if (!isNonEmptyLocatorObject(raw)) {
    return null;
  }
  const blockId = raw.blockId;
  const documentVersionId = raw.documentVersionId;
  const page = raw.page;
  if (typeof blockId !== 'string' || !isUuid(blockId)) {
    return null;
  }
  if (typeof documentVersionId !== 'string' || !isUuid(documentVersionId)) {
    return null;
  }
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
    return null;
  }
  return { blockId, documentVersionId, page };
}

export function quotedTextMatches(quote: string, source: string): boolean {
  const normalizedQuote = normalizeWhitespace(quote);
  const normalizedSource = normalizeWhitespace(source);
  return normalizedQuote.length > 0 && normalizedSource.includes(normalizedQuote);
}

export function locatorPointsAtBlock(
  locator: EvidenceLocator,
  block: StoredBlock | null,
): 'ok' | 'unresolved' | 'page_mismatch' {
  if (
    block !== null &&
    block.id === locator.blockId &&
    block.documentVersionId === locator.documentVersionId &&
    block.page !== locator.page
  ) {
    return 'page_mismatch';
  }
  if (!locatorResolves(locator, block)) {
    return 'unresolved';
  }
  return 'ok';
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
