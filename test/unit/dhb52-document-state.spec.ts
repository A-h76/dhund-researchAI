import {
  allowedDocumentSources,
  canTransitionDocument,
  DOCUMENT_STATUS_TRANSITIONS,
  DocumentTransitionError,
} from '../../src/l0/ports/document-state';
import type { DocumentLifecycleStatus } from '../../src/l0/ports/extract-store.port';
import { MemoryExtractStore } from '../fixtures/memory-extract-store';
import { generateId } from '../../src/platform/ids/uuid-v7';

const ALL_STATUSES: readonly DocumentLifecycleStatus[] = [
  'queued',
  'processing',
  'completed',
  'failed',
  'partial',
  'cancelled',
  'stale',
];

/** The full Phase 7 §1 table — every allowed pair, everything else forbidden. */
const ALLOWED: ReadonlySet<string> = new Set(
  [
    ['queued', 'processing'],
    ['queued', 'failed'],
    ['queued', 'cancelled'],
    ['queued', 'stale'],
    ['processing', 'partial'],
    ['processing', 'completed'],
    ['processing', 'failed'],
    ['processing', 'cancelled'],
    ['processing', 'stale'],
    ['partial', 'processing'],
    ['partial', 'failed'],
    ['partial', 'cancelled'],
    ['partial', 'stale'],
    ['completed', 'stale'],
    ['failed', 'processing'],
    ['failed', 'cancelled'],
    ['failed', 'stale'],
    ['stale', 'processing'],
    ['stale', 'failed'],
    ['stale', 'cancelled'],
  ].map(([from, to]) => `${from}->${to}`),
);

describe('DHB-52 document state machine', () => {
  it('allows exactly the Phase 7 transitions plus idempotent self-writes', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = from === to || ALLOWED.has(`${from}->${to}`);
        expect({ from, to, allowed: canTransitionDocument(from, to) }).toEqual({
          from,
          to,
          allowed: expected,
        });
      }
    }
  });

  it('rejects every backward move and every move out of a terminal state', () => {
    // cancelled is terminal.
    for (const to of ALL_STATUSES.filter((status) => status !== 'cancelled')) {
      expect(canTransitionDocument('cancelled', to)).toBe(false);
    }
    // completed may only go stale (re-ingest); never back to processing/queued.
    expect(canTransitionDocument('completed', 'processing')).toBe(false);
    expect(canTransitionDocument('completed', 'queued')).toBe(false);
    expect(canTransitionDocument('completed', 'partial')).toBe(false);
    expect(canTransitionDocument('completed', 'failed')).toBe(false);
    expect(canTransitionDocument('completed', 'stale')).toBe(true);
    // nothing ever returns to queued.
    for (const from of ALL_STATUSES.filter((status) => status !== 'queued')) {
      expect(canTransitionDocument(from, 'queued')).toBe(false);
    }
    // a partial chain never becomes completed.
    expect(canTransitionDocument('partial', 'completed')).toBe(false);
  });

  it('derives allowed sources consistently with the table', () => {
    expect([...allowedDocumentSources('completed')].sort()).toEqual(
      ['completed', 'processing'].sort(),
    );
    expect(allowedDocumentSources('stale')).toEqual(
      expect.arrayContaining(['completed', 'processing', 'partial', 'failed', 'queued']),
    );
    expect(allowedDocumentSources('queued')).toEqual(['queued']);
  });

  it('covers every status in the transition table', () => {
    expect(Object.keys(DOCUMENT_STATUS_TRANSITIONS).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });

  it('is enforced at the store: forbidden writes throw, allowed writes commit', async () => {
    const store = new MemoryExtractStore();
    const documentId = generateId();
    store.seedVersion({
      id: generateId(),
      documentId,
      orgId: generateId(),
      projectId: generateId(),
      storageKey: 'k',
      documentStatus: 'completed',
      deletedAt: null,
    });

    await expect(store.markDocumentStatus(documentId, 'processing')).rejects.toThrow(
      DocumentTransitionError,
    );
    expect(store.documentStatus.get(documentId)).toBe('completed');

    await store.markDocumentStatus(documentId, 'stale');
    expect(store.documentStatus.get(documentId)).toBe('stale');
    await store.markDocumentStatus(documentId, 'processing');
    await store.markDocumentStatus(documentId, 'completed');

    await expect(store.markDocumentStatus(documentId, 'cancelled')).rejects.toThrow(
      DocumentTransitionError,
    );
  });
});
