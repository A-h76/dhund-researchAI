import { generateId } from '../../src/platform/ids/uuid-v7';
import {
  normalizeDoi,
  parseUploadCompleteRequest,
} from '../../src/ingestion/parse-upload-request';
import { DomainError } from '../../src/platform/errors/domain-error';
import { MemoryUploadSessionStore } from '../fixtures/memory-upload-session-store';

const DOI = '10.1234/example.2026.001';

describe('DHB-52 DOI re-ingest (GAP-DOI-OVERWRITE-01)', () => {
  let store: MemoryUploadSessionStore;

  beforeEach(() => {
    store = new MemoryUploadSessionStore();
  });

  async function issueAndConsume(
    projectId: string,
    doi: string | null,
    storageKey = `keys/${generateId()}.pdf`,
  ) {
    const sessionId = generateId();
    await store.insertIssued(
      {
        id: sessionId,
        projectId,
        orgId: 'org-1',
        initiatedBy: 'user-1',
        filename: 'paper.pdf',
        sizeBytes: 100,
        mimeType: 'application/pdf',
        storageKey,
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyScope: `upload:${projectId}`,
        idempotencyKey: generateId(),
        requestFingerprint: 'fp',
      },
      10,
    );
    const consumed = await store.consume({
      sessionId,
      documentId: generateId(),
      documentVersionId: generateId(),
      title: 'paper.pdf',
      doi,
    });
    expect(consumed).not.toBeNull();
    return { consumed: consumed!, storageKey };
  }

  it('same DOI, same project → ONE document with TWO versions, not two documents', async () => {
    const projectId = generateId();
    const first = await issueAndConsume(projectId, DOI);
    const second = await issueAndConsume(projectId, DOI);

    expect(second.consumed.documentId).toBe(first.consumed.documentId);
    expect(second.consumed.documentVersionId).not.toBe(
      first.consumed.documentVersionId,
    );

    const documents = store.documentsInProject(projectId);
    expect(documents).toHaveLength(1);
    expect(documents[0]!.versions.map((version) => version.versionNo)).toEqual([1, 2]);
    // The document is stale for the old version until the new chain completes.
    expect(documents[0]!.status).toBe('stale');
    // The old version remains — evidence bound to v1 still resolves.
    expect(
      documents[0]!.versions.find(
        (version) => version.documentVersionId === first.consumed.documentVersionId,
      ),
    ).toBeDefined();
  });

  it('same DOI, different project → two separate documents', async () => {
    const projectA = generateId();
    const projectB = generateId();
    const first = await issueAndConsume(projectA, DOI);
    const second = await issueAndConsume(projectB, DOI);

    expect(second.consumed.documentId).not.toBe(first.consumed.documentId);
    expect(store.documentsInProject(projectA)).toHaveLength(1);
    expect(store.documentsInProject(projectB)).toHaveLength(1);
  });

  it('no DOI → every upload creates its own document (no accidental merging)', async () => {
    const projectId = generateId();
    await issueAndConsume(projectId, null);
    await issueAndConsume(projectId, null);
    expect(store.documentsInProject(projectId)).toHaveLength(2);
  });

  it('replay lookup resolves the version created for that upload, both v1 and v2', async () => {
    const projectId = generateId();
    const first = await issueAndConsume(projectId, DOI);
    const second = await issueAndConsume(projectId, DOI);

    const v1 = await store.findDocumentByStorageKey(projectId, first.storageKey);
    const v2 = await store.findDocumentByStorageKey(projectId, second.storageKey);
    expect(v1?.documentVersionId).toBe(first.consumed.documentVersionId);
    expect(v2?.documentVersionId).toBe(second.consumed.documentVersionId);
    expect(v1?.documentId).toBe(v2?.documentId);
  });

  it('normalizes DOI forms and rejects malformed ones', () => {
    expect(normalizeDoi('https://doi.org/10.1234/AbC')).toBe('10.1234/abc');
    expect(normalizeDoi('doi:10.1234/x')).toBe('10.1234/x');
    expect(normalizeDoi(' 10.1234/x ')).toBe('10.1234/x');
    expect(normalizeDoi('not-a-doi')).toBeNull();
    expect(normalizeDoi('11.1234/x')).toBeNull();

    expect(parseUploadCompleteRequest(undefined)).toEqual({ doi: null });
    expect(parseUploadCompleteRequest({})).toEqual({ doi: null });
    expect(parseUploadCompleteRequest({ doi: 'https://doi.org/10.9999/Z' })).toEqual({
      doi: '10.9999/z',
    });
    expect(() => parseUploadCompleteRequest({ doi: 42 })).toThrow(DomainError);
    expect(() => parseUploadCompleteRequest({ doi: 'nope' })).toThrow(DomainError);
  });
});
