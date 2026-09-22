import { DomainError } from '../../src/platform/errors/domain-error';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { CitationMetrics } from '../../src/evidence/citations.metrics';
import {
  exportBibliography,
  identityFromCitation,
  parseExport,
  type BibliographicIdentity,
} from '../../src/evidence/citation-export';
import { CitationExportService } from '../../src/evidence/citation-export.service';
import { WritingPersistenceService } from '../../src/evidence/writing-persistence.service';
import type { CitationProjectionPort, CitationRecord } from '../../src/l0/ports/citation-projection.port';
import { LibraryService } from '../../src/ingestion/library.service';
import { LibraryMetrics } from '../../src/ingestion/library.metrics';
import type { AccessContextService } from '../../src/iam/authorization/access-context.service';
import type { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { BindingOccupancy } from '../fixtures/binding-occupancy';
import { MemoryLibraryStore } from '../fixtures/memory-library-store';
import { MemoryMessageEvidenceBindings } from '../fixtures/memory-message-evidence-bindings';
import { MemoryWritingStore } from '../fixtures/memory-writing-store';

const AUTHORIZATION = 'Bearer test';

describe('DHB-72 writing, library, and citation export', () => {
  it('GAP-WRITING-01: rejects a version update and keeps earlier bindings stable', async () => {
    const { writings, store, projectId, userId } = writingWorld();
    const writing = await writings.createWriting({
      projectId,
      title: 'Draft',
      createdBy: userId,
    });
    const evidenceA = generateId();
    const evidenceB = generateId();
    store.seedEvidence(projectId, evidenceA);
    store.seedEvidence(projectId, evidenceB);
    const first = await writings.appendVersion({
      projectId,
      writingId: writing.id,
      contentRef: 'ref-1',
      createdBy: userId,
    });
    const bound = await writings.bindSentence({
      projectId,
      writingId: writing.id,
      writingVersionId: first.id,
      sentenceHash: 'hash-1',
      evidenceId: evidenceA,
      strength: '1',
    });
    await expect(writings.updateVersion()).rejects.toMatchObject({
      code: ErrorCode.InvalidStateTransition,
    });
    const second = await writings.appendVersion({
      projectId,
      writingId: writing.id,
      contentRef: 'ref-2',
      createdBy: userId,
    });
    await writings.bindSentence({
      projectId,
      writingId: writing.id,
      writingVersionId: second.id,
      sentenceHash: 'hash-2',
      evidenceId: evidenceB,
      strength: '1',
    });
    const earlier = await writings.listBindings(projectId, first.id);
    expect(earlier).toEqual([bound]);
    expect(earlier[0]?.evidenceId).toBe(evidenceA);
    const later = await writings.listBindings(projectId, second.id);
    expect(later.map((row) => row.evidenceId)).toEqual([evidenceB]);
  });

  it('resolves a binding to live evidence after supersession without counting a failure', async () => {
    const { writings, store, projectId, userId, metrics } = writingWorld();
    const writing = await writings.createWriting({
      projectId,
      title: 'Draft',
      createdBy: userId,
    });
    const original = generateId();
    const successor = generateId();
    store.seedEvidence(projectId, original);
    const version = await writings.appendVersion({
      projectId,
      writingId: writing.id,
      contentRef: 'ref-1',
      createdBy: userId,
    });
    const binding = await writings.bindSentence({
      projectId,
      writingId: writing.id,
      writingVersionId: version.id,
      sentenceHash: 'hash-1',
      evidenceId: original,
      strength: '0.5',
    });
    store.supersede(original, successor);
    const live = await writings.resolveBinding(projectId, binding);
    expect(live?.id).toBe(successor);
    expect(binding.evidenceId).toBe(original);
    expect(metrics.snapshot().bindingResolutionFailures).toBe(0);
  });

  it('keeps writing bindings out of message bindings and the reverse', async () => {
    const occupancy = new BindingOccupancy();
    const store = new MemoryWritingStore(occupancy);
    const messages = new MemoryMessageEvidenceBindings(occupancy);
    const metrics = new CitationMetrics();
    const writings = new WritingPersistenceService(store, metrics);
    const projectId = generateId();
    const userId = generateId();
    const shared = generateId();
    const writingOnly = generateId();
    store.seedEvidence(projectId, shared);
    store.seedEvidence(projectId, writingOnly);
    messages.seedEvidence(projectId, shared);
    messages.seedEvidence(projectId, writingOnly);
    const writing = await writings.createWriting({
      projectId,
      title: 'Draft',
      createdBy: userId,
    });
    const version = await writings.appendVersion({
      projectId,
      writingId: writing.id,
      contentRef: 'ref-1',
      createdBy: userId,
    });
    await messages.insertMany(
      { projectId },
      [{ id: generateId(), messageId: generateId(), evidenceId: shared, projectId }],
    );
    await expect(
      writings.bindSentence({
        projectId,
        writingId: writing.id,
        writingVersionId: version.id,
        sentenceHash: 'hash-shared',
        evidenceId: shared,
        strength: '1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
    await writings.bindSentence({
      projectId,
      writingId: writing.id,
      writingVersionId: version.id,
      sentenceHash: 'hash-writing',
      evidenceId: writingOnly,
      strength: '1',
    });
    await expect(
      messages.insertMany(
        { projectId },
        [{ id: generateId(), messageId: generateId(), evidenceId: writingOnly, projectId }],
      ),
    ).rejects.toThrow(/disjoint/);
    expect(messages.rows.map((row) => row.evidenceId)).toEqual([shared]);
    expect((await writings.listBindings(projectId, version.id)).map((row) => row.evidenceId)).toEqual([
      writingOnly,
    ]);
  });

  it('returns 404 for a writing binding in another project', async () => {
    const { writings, store, projectId, userId } = writingWorld();
    const writing = await writings.createWriting({
      projectId,
      title: 'Draft',
      createdBy: userId,
    });
    const evidenceId = generateId();
    store.seedEvidence(projectId, evidenceId);
    const version = await writings.appendVersion({
      projectId,
      writingId: writing.id,
      contentRef: 'ref-1',
      createdBy: userId,
    });
    await expect(
      writings.bindSentence({
        projectId: generateId(),
        writingId: writing.id,
        writingVersionId: version.id,
        sentenceHash: 'hash-1',
        evidenceId,
        strength: '1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
  });

  it('GAP-LIB-01: projects bibliography, keeps note in metadata, and rejects a new target', async () => {
    const projectId = generateId();
    const otherProjectId = generateId();
    const store = new MemoryLibraryStore();
    const metrics = new LibraryMetrics();
    const library = libraryFor(store, projectId, metrics);
    const documentId = generateId();
    const foreignDocumentId = generateId();
    const externalId = generateId();
    store.seedDocument({
      id: documentId,
      projectId,
      title: 'Observed paper',
      authors: ['Ada Lovelace'],
      year: 1843,
      storageKey: 'objects/paper.pdf',
    });
    store.seedDocument({
      id: foreignDocumentId,
      projectId: otherProjectId,
      title: 'Foreign',
      authors: [],
      year: null,
      storageKey: 'objects/foreign.pdf',
    });
    store.seedExternal({
      id: externalId,
      projectId,
      title: 'External record',
      authors: ['Grace Hopper'],
      year: 1952,
    });

    const folder = await library.createFolder(AUTHORIZATION, projectId, { name: 'Reading' });
    const child = await library.createFolder(AUTHORIZATION, projectId, {
      name: 'Week',
      parentFolderId: folder.id,
    });
    const item = await library.createItem(AUTHORIZATION, projectId, {
      documentId,
      folderId: child.id,
      note: 'check the methods',
    });
    expect(item.note).toBe('check the methods');
    expect(item.title).toBe('Observed paper');
    expect(item.authors).toEqual(['Ada Lovelace']);
    expect(item.year).toBe(1843);
    expect(item.target).toEqual({ type: 'document', id: documentId });
    expect(item).not.toHaveProperty('downloadUrl');
    expect(item).not.toHaveProperty('bytes');
    expect(item).not.toHaveProperty('storageKey');
    const stored = await store.findItem(projectId, item.id);
    expect(stored?.metadata.note).toBe('check the methods');
    expect(stored).not.toHaveProperty('title');
    expect(stored).not.toHaveProperty('note');

    const externalItem = await library.createItem(AUTHORIZATION, projectId, {
      externalRecordId: externalId,
    });
    expect(externalItem.title).toBe('External record');
    expect(externalItem.target.type).toBe('external_record');

    await expect(
      library.updateItem(AUTHORIZATION, projectId, item.id, { documentId: foreignDocumentId }),
    ).rejects.toMatchObject({ code: ErrorCode.ValidationError });
    expect((await store.findItem(projectId, item.id))?.documentId).toBe(documentId);

    await expect(
      library.createItem(AUTHORIZATION, projectId, {}),
    ).rejects.toMatchObject({ code: ErrorCode.LibraryItemTargetInvalid });
    await expect(
      library.createItem(AUTHORIZATION, projectId, {
        documentId,
        externalRecordId: externalId,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.LibraryItemTargetInvalid });

    await expect(
      library.createItem(AUTHORIZATION, projectId, { documentId: foreignDocumentId }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      library.createItem(AUTHORIZATION, projectId, { documentId: foreignDocumentId }),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });

    const foreignFolder = generateId();
    store.folders.set(foreignFolder, {
      id: foreignFolder,
      projectId: otherProjectId,
      parentFolderId: null,
      name: 'Elsewhere',
      position: 0,
      deletedAt: null,
    });
    await expect(
      library.createFolder(AUTHORIZATION, projectId, {
        name: 'Nope',
        parentFolderId: foreignFolder,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });

    await library.deleteFolder(AUTHORIZATION, projectId, folder.id);
    const listed = await library.listItems(AUTHORIZATION, projectId);
    const moved = listed.items.find((row) => row.id === item.id);
    expect(moved?.folderId).toBeNull();
    expect((await library.listFolders(AUTHORIZATION, projectId)).folders.map((row) => row.id)).not.toContain(
      child.id,
    );
    expect((await store.listDocuments(projectId)).map((row) => row.id)).toContain(documentId);
    expect(store.documentStorageKey(documentId)).toBe('objects/paper.pdf');
    expect(metrics.snapshot().itemsByTarget).toEqual({ document: 1, external_record: 1 });
    expect(metrics.snapshot().folderOperations.delete).toBe(1);
  });

  it('PX-e: export keeps the grounding label and round-trips bibliographic identity', async () => {
    const grounded = identity({ grounding: 'body_grounded', title: 'Grounded paper' });
    const metadata = identity({ grounding: 'metadata_only', title: 'Metadata paper' });
    for (const format of ['csl', 'bibtex', 'ris'] as const) {
      const body = exportBibliography(format, [grounded, metadata]);
      expect(body).toContain('body_grounded');
      expect(body).toContain('metadata_only');
      expect(body).not.toContain('Grounded paper body_grounded');
      expect(parseExport(format, body)).toEqual([grounded, metadata]);
    }

    const metrics = new CitationMetrics();
    const projectId = generateId();
    const citation: CitationRecord = {
      id: generateId(),
      projectId,
      writingId: null,
      resolvesToEvidenceId: generateId(),
      resolvesToSourceId: null,
      cslJson: { title: grounded.title, author: [{ literal: 'Ada Lovelace' }], year: 1843 },
      qualityAnnotation: 'body_grounded',
    };
    const service = new CitationExportService(citationPort([citation]), metrics);
    const exported = await service.exportProject(projectId, 'bibtex');
    const [parsed] = parseExport('bibtex', exported.body);
    expect(parsed?.grounding).toBe('body_grounded');
    expect(parsed?.title).toBe('Grounded paper');
    expect(identityFromCitation(citation).grounding).toBe('body_grounded');
    expect(metrics.snapshot().exportsByFormat.bibtex).toBe(1);
  });
});

function writingWorld(): {
  writings: WritingPersistenceService;
  store: MemoryWritingStore;
  projectId: string;
  userId: string;
  metrics: CitationMetrics;
} {
  const metrics = new CitationMetrics();
  const store = new MemoryWritingStore();
  return {
    writings: new WritingPersistenceService(store, metrics),
    store,
    projectId: generateId(),
    userId: generateId(),
    metrics,
  };
}

function libraryFor(
  store: MemoryLibraryStore,
  projectId: string,
  metrics: LibraryMetrics,
): LibraryService {
  const userId = generateId();
  const orgId = generateId();
  const tokens = {
    verify: async () => ({ sub: userId }),
  } as unknown as AccessTokenService;
  const context = {
    resolve: async () => ({
      userId,
      orgs: [{ orgId, role: 'MEMBER' as const }],
      projects: [{ projectId, orgId, role: 'OWNER' as const }],
    }),
  } as unknown as AccessContextService;
  return new LibraryService(tokens, context, store, metrics);
}

function identity(overrides: Pick<BibliographicIdentity, 'grounding' | 'title'>): BibliographicIdentity {
  return {
    title: overrides.title,
    authors: ['Ada Lovelace'],
    year: 1843,
    doi: '10.1000/dhund',
    grounding: overrides.grounding,
  };
}

function citationPort(rows: readonly CitationRecord[]): CitationProjectionPort {
  return {
    createCitation: async () => {
      throw new Error('unused');
    },
    listCitations: async (projectId) => rows.filter((row) => row.projectId === projectId),
    findWriting: async () => null,
    listBindingsForSentence: async () => [],
  };
}
