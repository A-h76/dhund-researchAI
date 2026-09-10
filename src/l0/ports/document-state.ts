import type { DocumentLifecycleStatus } from './extract-store.port';

/**
 * Document lifecycle state machine (Phase 7 §1).
 *
 * Backward moves are forbidden. `cancelled` is terminal. `partial` may never
 * become `completed` — a partial chain never completes.
 *
 * `completed` may become `stale` (a newer version arrived via DOI re-ingest) or
 * `partial`: chunking completes a document before its chunks are embedded, so a
 * failed embed (DHB-53 §25.2) degrades a completed document rather than leaving
 * it advertised as fully retrievable. Because `partial` never returns to
 * `completed`, the degradation is one-way until the document is re-ingested.
 */
export const DOCUMENT_STATUS_TRANSITIONS: Readonly<
  Record<DocumentLifecycleStatus, readonly DocumentLifecycleStatus[]>
> = {
  queued: ['processing', 'failed', 'cancelled', 'stale'],
  processing: ['partial', 'completed', 'failed', 'cancelled', 'stale'],
  partial: ['processing', 'failed', 'cancelled', 'stale'],
  completed: ['partial', 'stale'],
  failed: ['processing', 'cancelled', 'stale'],
  stale: ['processing', 'failed', 'cancelled'],
  cancelled: [],
};

/** Same-status writes are allowed as no-ops (idempotent job replays). */
export function canTransitionDocument(
  from: DocumentLifecycleStatus,
  to: DocumentLifecycleStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return DOCUMENT_STATUS_TRANSITIONS[from].includes(to);
}

/** All statuses from which `to` is reachable (including `to` itself as no-op). */
export function allowedDocumentSources(
  to: DocumentLifecycleStatus,
): readonly DocumentLifecycleStatus[] {
  return (Object.keys(DOCUMENT_STATUS_TRANSITIONS) as DocumentLifecycleStatus[]).filter(
    (from) => canTransitionDocument(from, to),
  );
}

export class DocumentTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Forbidden document transition ${from} -> ${to}`);
    this.name = 'DocumentTransitionError';
  }
}
