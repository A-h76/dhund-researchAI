import { TENANT_ENTITIES, type TenantEntity } from '../../src/l0/ports/scoped-store.port';
import { ClaimsRepository } from '../../src/evidence/scoped-repos';
import { EvidenceMetrics } from '../../src/evidence/evidence.metrics';
import { EvidenceRepository } from '../../src/evidence/evidence.repository';
import { SourcesRepository } from '../../src/evidence/sources.repository';
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
import { DomainError, httpStatusFor } from '../../src/platform/errors';
import { generateId } from '../../src/platform/ids/uuid-v7';
import type { PlatformLogger } from '../../src/platform/logging';
import { ScopedMetrics } from '../../src/platform/persistence/scoped.metrics';
import { ScopedReader } from '../../src/platform/persistence/scoped-reader';
import { MemoryChunkStore } from '../fixtures/memory-chunk-store';
import { MemoryExtractStore } from '../fixtures/memory-extract-store';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';
import { idorGateVerdict } from '../static/architecture/conformance';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

interface EntityRepo {
  get(scope: { projectId: string }, id: string): Promise<unknown>;
  update(
    scope: { projectId: string },
    id: string,
    patch: Record<string, unknown>,
  ): Promise<unknown>;
  remove(scope: { projectId: string }, id: string): Promise<void>;
}

function repos(reader: ScopedReader, store: MemoryScopedStore): Record<TenantEntity, EntityRepo> {
  const extract = new MemoryExtractStore();
  const chunks = new MemoryChunkStore(extract);
  return {
    document: new DocumentsRepository(reader),
    evidence: new EvidenceRepository(reader, store, chunks, extract, new EvidenceMetrics(stubLogger())),
    claim: new ClaimsRepository(reader),
    research_run: new ResearchRunsRepository(reader),
    extraction_cell: new ExtractionCellsRepository(reader),
    conversation: new ConversationsRepository(reader, store),
    message: new MessagesRepository(reader, store),
    research_artifact: new ResearchArtifactsRepository(reader),
    screening_decision: new ScreeningDecisionsRepository(reader),
    external_record: new ExternalRecordsRepository(reader),
    source: new SourcesRepository(reader, store),
  };
}

function httpBody(error: unknown): { status: number; body: unknown } {
  if (error instanceof DomainError) {
    return {
      status: httpStatusFor(error.code),
      body: {
        code: error.code,
        message: error.userMessage,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }
  return { status: 500, body: { leaked: true } };
}

async function expectCrossTenant404(op: Promise<unknown>, secret: string): Promise<void> {
  let row: unknown;
  try {
    row = await op;
  } catch (error) {
    if (!(error instanceof DomainError)) {
      throw error;
    }
    const http = httpBody(error);
    expect(http.status).toBe(404);
    expect(JSON.stringify(http.body)).not.toContain(secret);
    expect(idorGateVerdict(http.status, http.body, secret)).toBe('pass');
    return;
  }
  expect(idorGateVerdict(200, row, secret)).toBe('pass');
}

describe('IDOR gate', () => {
  it('blocks a cross-tenant 200', () => {
    expect(idorGateVerdict(200, { title: 'idor-secret' }, 'idor-secret')).toBe('block');
  });

  it('blocks a cross-tenant 403 that carries resource data', () => {
    expect(
      idorGateVerdict(403, { code: 'forbidden', title: 'idor-secret' }, 'idor-secret'),
    ).toBe('block');
  });

  it('passes a 404 whose body has no resource data', () => {
    expect(
      idorGateVerdict(404, { code: 'not_found', message: 'Resource not found.' }, 'idor-secret'),
    ).toBe('pass');
  });

  it.each([...TENANT_ENTITIES])(
    'returns 404 with no body data for cross-tenant %s access',
    async (entity) => {
      const projectA = generateId();
      const projectB = generateId();
      const store = new MemoryScopedStore();
      const reader = new ScopedReader(store, new ScopedMetrics(stubLogger()));
      const secret = `idor-secret-${entity}`;
      const id = generateId();
      await store.insert(entity, { projectId: projectA }, {
        id,
        title: secret,
        storageKey: `key-${id}`,
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
      const repo = repos(reader, store)[entity];
      const other = { projectId: projectB };
      await expectCrossTenant404(repo.get(other, id), secret);
      await expectCrossTenant404(repo.update(other, id, { title: 'stolen' }), secret);
      await expectCrossTenant404(repo.remove(other, id), secret);
      const stillThere = await store.get(entity, { projectId: projectA }, id);
      expect(stillThere?.title).toBe(secret);
    },
  );
});
