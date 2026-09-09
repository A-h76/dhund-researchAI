import { TENANT_ENTITIES, type TenantEntity } from '../../src/l0/ports/scoped-store.port';
import { ClaimsRepository, EvidenceRepository } from '../../src/evidence/scoped-repos';
import { DocumentsRepository } from '../../src/ingestion/documents.repository';
import { ExternalRecordsRepository } from '../../src/ingestion/external-records.repository';
import {
  ConversationsRepository,
  ExtractionCellsRepository,
  MessagesRepository,
  ResearchArtifactsRepository,
  ResearchRunsRepository,
  ScreeningDecisionsRepository,
} from '../../src/orchestration/scoped-repos';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import type { PlatformLogger } from '../../src/platform/logging';
import { encodeCursor } from '../../src/platform/persistence/cursor';
import { ScopedMetrics } from '../../src/platform/persistence/scoped.metrics';
import { ScopedReader } from '../../src/platform/persistence/scoped-reader';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';

function stubLogger(logs: unknown[]): PlatformLogger {
  return {
    info: (fields: unknown) => logs.push(fields),
    warn: (fields: unknown) => logs.push(fields),
    error: (fields: unknown) => logs.push(fields),
    debug: (fields: unknown) => logs.push(fields),
  } as unknown as PlatformLogger;
}

async function expectRejectsNotFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: ErrorCode.NotFound });
}

interface EntityRepo {
  get(scope: { projectId: string }, id: string): Promise<unknown>;
  update(
    scope: { projectId: string },
    id: string,
    patch: Record<string, unknown>,
  ): Promise<unknown>;
  remove(scope: { projectId: string }, id: string): Promise<void>;
  list(
    scope: { projectId: string },
    query: { limit: number; afterId?: string },
  ): Promise<readonly unknown[]>;
}

function repos(reader: ScopedReader): Record<TenantEntity, EntityRepo> {
  return {
    document: new DocumentsRepository(reader),
    evidence: new EvidenceRepository(reader),
    claim: new ClaimsRepository(reader),
    research_run: new ResearchRunsRepository(reader),
    extraction_cell: new ExtractionCellsRepository(reader),
    conversation: new ConversationsRepository(reader),
    message: new MessagesRepository(reader),
    research_artifact: new ResearchArtifactsRepository(reader),
    screening_decision: new ScreeningDecisionsRepository(reader),
    external_record: new ExternalRecordsRepository(reader),
  };
}

describe('DHB-38 IDOR-404 scoped repositories', () => {
  const projectA = generateId();
  const projectB = generateId();
  const scopeA = { projectId: projectA };
  const scopeB = { projectId: projectB };

  let store: MemoryScopedStore;
  let logs: unknown[];
  let metrics: ScopedMetrics;
  let reader: ScopedReader;
  let accessors: Record<TenantEntity, EntityRepo>;

  beforeEach(() => {
    store = new MemoryScopedStore();
    logs = [];
    metrics = new ScopedMetrics(stubLogger(logs));
    reader = new ScopedReader(store, metrics);
    accessors = repos(reader);
  });

  it.each([...TENANT_ENTITIES])(
    'returns not_found for cross-tenant get/update/delete on %s',
    async (entity) => {
      const id = generateId();
      await store.insert(entity, scopeA, {
        id,
        title: `secret-${entity}`,
        storageKey: `key-${id}`,
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
      const repo = accessors[entity];
      await expectRejectsNotFound(repo.get(scopeB, id));
      await expectRejectsNotFound(repo.update(scopeB, id, { title: 'stolen' }));
      await expectRejectsNotFound(repo.remove(scopeB, id));
      const stillThere = await store.get(entity, scopeA, id);
      expect(stillThere).not.toBeNull();
      expect(stillThere?.title).toBe(`secret-${entity}`);
      if (entity === 'document') {
        const dto = await repo.get(scopeA, id);
        expect(dto).not.toHaveProperty('storageKey');
      }
    },
  );

  it.each([...TENANT_ENTITIES])(
    'returns an empty page for a tampered %s cursor',
    async (entity) => {
      const idA = generateId();
      const idB = generateId();
      await store.insert(entity, scopeA, { id: idA, title: 'A' });
      await store.insert(entity, scopeB, { id: idB, title: 'B' });
      const listed = await accessors[entity].list(scopeB, {
        limit: 50,
        afterId: idA,
      });
      expect(listed).toEqual([]);
      const decoded = encodeCursor(idA);
      expect(decoded.length).toBeGreaterThan(8);
    },
  );

  it('skips soft-deleted documents on later get and list', async () => {
    const id = generateId();
    await store.insert('document', scopeA, { id, title: 'gone' });
    await accessors.document.remove(scopeA, id);
    await expectRejectsNotFound(accessors.document.get(scopeA, id));
    const listed = await accessors.document.list(scopeA, { limit: 50 });
    expect(listed.some((row) => (row as { id: string }).id === id)).toBe(false);
  });

  it('does not log the requested resource id on IDOR denial', async () => {
    const id = generateId();
    await store.insert('document', scopeA, { id, title: 'Secret' });
    await expectRejectsNotFound(accessors.document.get(scopeB, id));
    expect(JSON.stringify(logs)).not.toContain(id);
    expect(logs.some((row) => JSON.stringify(row).includes('scoped.not_found'))).toBe(
      true,
    );
  });
});
