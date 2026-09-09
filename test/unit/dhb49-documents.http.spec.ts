import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import {
  OBJECT_STORAGE_SERVICE,
  ORPHAN_SWEEP_STORE,
  SESSION_STORE,
  TENANCY_STORE,
  SCOPED_STORE,
  type LiveDocumentRecord,
  type OrphanSweepStore,
  type ScopedRow,
} from '../../src/l0/ports';
import { APP_CONFIG } from '../../src/platform/config';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import {
  correlationExpressMiddleware,
  JobEnqueueService,
  PlatformLogger,
} from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { encodeCursor } from '../../src/platform/persistence/cursor';
import { ScopedMetrics } from '../../src/platform/persistence/scoped.metrics';
import { ScopedReader } from '../../src/platform/persistence/scoped-reader';
import { DocumentAccessController } from '../../src/ingestion/document-access.controller';
import { DocumentsController } from '../../src/ingestion/documents.controller';
import { DocumentsRepository } from '../../src/ingestion/documents.repository';
import { DocumentsService } from '../../src/ingestion/documents.service';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';
import { MemoryTenancyStore } from '../fixtures/memory-tenancy-store';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';
import { tenancyGuardProviders } from '../fixtures/access-auth-providers';

async function json(
  baseUrl: string,
  method: string,
  path: string,
  opts: { token?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    [CORRELATION_ID_HEADER]: 'cor-dhb49-http',
  };
  if (opts.token !== undefined) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers });
  const raw = await response.text();
  return {
    status: response.status,
    body: raw.length === 0 ? null : (JSON.parse(raw) as Record<string, unknown>),
  };
}

async function tokenFor(
  tokens: AccessTokenService,
  sessions: MemorySessionStore,
  userId: string,
): Promise<string> {
  const sessionId = generateId();
  sessions.sessions.set(sessionId, {
    sessionId,
    userId,
    revokedAt: null,
    userSessionVersion: 1,
  });
  return tokens.sign({ sub: userId, sid: sessionId, sv: 1 });
}

function sweepStoreFrom(scoped: MemoryScopedStore, orgByProject: Map<string, string>): OrphanSweepStore {
  return {
    async findLiveById(id: string): Promise<LiveDocumentRecord | null> {
      const row = (scoped.rows.get('document') ?? []).find(
        (candidate) => candidate.id === id && candidate.deletedAt == null,
      );
      if (row === undefined) {
        return null;
      }
      return toLive(row, orgByProject);
    },
    async listOwnedStorageKeys() {
      return { ok: true, keys: new Set<string>() };
    },
    async retireVersion() {
      return false;
    },
    async addVersion() {
      return;
    },
    async countChunksForDocument() {
      return 0;
    },
    async countEmbeddingsForDocument() {
      return 0;
    },
  };
}

function toLive(row: ScopedRow, orgByProject: Map<string, string>): LiveDocumentRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    orgId: orgByProject.get(row.projectId) ?? String(row.orgId ?? ''),
    status: String(row.status ?? ''),
    storageKey: String(row.storageKey ?? ''),
  };
}

describe('DHB-49 document list/status/download/delete HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let store: MemoryScopedStore;
  let storage: MemoryObjectStorage;
  let tokens: AccessTokenService;
  let sessions: MemorySessionStore;
  let enqueue: { enqueue: jest.Mock };
  let orgA: string;
  let orgB: string;
  let projectA: string;
  let projectB: string;
  let userA: string;
  let userB: string;
  let viewerA: string;
  let docA: string;
  let docB: string;
  let docPartial: string;
  let docFailed: string;
  let keyA: string;
  let keyB: string;

  beforeAll(async () => {
    const jwt = generateTestJwtConfig();
    const config = installTestAppConfig({ jwt });
    sessions = new MemorySessionStore();
    const tenancy = new MemoryTenancyStore();
    store = new MemoryScopedStore();
    storage = new MemoryObjectStorage();
    enqueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    orgA = generateId();
    orgB = generateId();
    projectA = generateId();
    projectB = generateId();
    userA = generateId();
    userB = generateId();
    viewerA = generateId();
    tenancy.seedOrg({ id: orgA, kind: 'TEAM', name: 'Org A', ownerUserId: null });
    tenancy.seedOrg({ id: orgB, kind: 'TEAM', name: 'Org B', ownerUserId: null });
    tenancy.seedProject({ id: projectA, orgId: orgA, name: 'A', settings: {} });
    tenancy.seedProject({ id: projectB, orgId: orgB, name: 'B', settings: {} });
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId: orgA,
      userId: userA,
      role: 'MEMBER',
    });
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId: orgA,
      userId: viewerA,
      role: 'MEMBER',
    });
    tenancy.seedOrgMembership({
      id: generateId(),
      orgId: orgB,
      userId: userB,
      role: 'MEMBER',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId: projectA,
      userId: userA,
      role: 'EDITOR',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId: projectA,
      userId: viewerA,
      role: 'VIEWER',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId: projectB,
      userId: userB,
      role: 'EDITOR',
    });

    docA = generateId();
    docB = generateId();
    docPartial = generateId();
    docFailed = generateId();
    keyA = `${orgA}/${projectA}/docs/${docA}/paper.pdf`;
    keyB = `${orgB}/${projectB}/docs/${docB}/paper.pdf`;
    const createdAt = new Date().toISOString();
    await store.insert('document', { projectId: projectA }, {
      id: docA,
      title: 'Alpha secret',
      status: 'completed',
      createdAt,
      storageKey: keyA,
      orgId: orgA,
    });
    await store.insert('document', { projectId: projectA }, {
      id: docPartial,
      title: 'Partial',
      status: 'partial',
      createdAt,
      storageKey: `${orgA}/${projectA}/docs/${docPartial}/partial.pdf`,
      orgId: orgA,
    });
    await store.insert('document', { projectId: projectA }, {
      id: docFailed,
      title: 'Failed',
      status: 'failed',
      createdAt,
      storageKey: `${orgA}/${projectA}/docs/${docFailed}/failed.pdf`,
      orgId: orgA,
    });
    await store.insert('document', { projectId: projectB }, {
      id: docB,
      title: 'Beta secret',
      status: 'queued',
      createdAt,
      storageKey: keyB,
      orgId: orgB,
    });

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as PlatformLogger;
    const orgByProject = new Map([
      [projectA, orgA],
      [projectB, orgB],
    ]);

    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentsController, DocumentAccessController],
      providers: [
        DocumentsService,
        DocumentsRepository,
        ScopedReader,
        ScopedMetrics,
        AccessTokenService,
        ...tenancyGuardProviders(),
        { provide: APP_CONFIG, useValue: config },
        { provide: SESSION_STORE, useValue: sessions },
        { provide: TENANCY_STORE, useValue: tenancy },
        { provide: SCOPED_STORE, useValue: store },
        { provide: ORPHAN_SWEEP_STORE, useValue: sweepStoreFrom(store, orgByProject) },
        { provide: OBJECT_STORAGE_SERVICE, useValue: storage },
        { provide: JobEnqueueService, useValue: enqueue },
        { provide: PlatformLogger, useValue: logger },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(correlationExpressMiddleware);
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    tokens = app.get(AccessTokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('paginates the project-scoped list and hides foreign documents', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    const first = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents?limit=1`,
      { token },
    );
    expect(first.status).toBe(200);
    expect((first.body?.items as unknown[]).length).toBe(1);
    expect(typeof first.body?.nextCursor).toBe('string');
    const second = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents?limit=1&cursor=${encodeURIComponent(String(first.body?.nextCursor))}`,
      { token },
    );
    expect(second.status).toBe(200);
    expect(JSON.stringify(first.body)).not.toContain('Beta secret');
    expect(JSON.stringify(second.body)).not.toContain('Beta secret');

    const foreignList = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents`,
      { token: await tokenFor(tokens, sessions, userB) },
    );
    expect(foreignList.status).toBe(404);
    expect(foreignList.body?.code).toBe(ErrorCode.NotFound);

    const forged = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectB}/documents?cursor=${encodeURIComponent(encodeCursor(docA))}`,
      { token: await tokenFor(tokens, sessions, userB) },
    );
    expect(forged.status).toBe(200);
    expect(JSON.stringify(forged.body)).not.toContain('Alpha secret');
  });

  it('returns partial and failed status honestly', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    const partial = await json(baseUrl, 'GET', `/v1/documents/${docPartial}/status`, {
      token,
    });
    const failed = await json(baseUrl, 'GET', `/v1/documents/${docFailed}/status`, {
      token,
    });
    expect(partial.status).toBe(200);
    expect(partial.body).toEqual({ id: docPartial, status: 'partial' });
    expect(failed.status).toBe(200);
    expect(failed.body).toEqual({ id: docFailed, status: 'failed' });
    expect(JSON.stringify(partial.body)).not.toContain('completed');
    expect(JSON.stringify(partial.body)).not.toContain('storageKey');
  });

  it('mints a project-scoped presigned GET and rejects cross-project callers', async () => {
    const own = await json(baseUrl, 'GET', `/v1/documents/${docA}/download`, {
      token: await tokenFor(tokens, sessions, userA),
    });
    expect(own.status).toBe(200);
    expect(own.body?.downloadUrl).toBe(`memory://get/${keyA}`);
    expect(typeof own.body?.expiresAt).toBe('string');
    expect(String(own.body?.downloadUrl)).toContain(projectA);
    expect(String(own.body?.downloadUrl)).not.toContain(projectB);
    expect(own.body).not.toHaveProperty('storageKey');

    const cross = await json(baseUrl, 'GET', `/v1/documents/${docA}/download`, {
      token: await tokenFor(tokens, sessions, userB),
    });
    expect(cross.status).toBe(404);
    expect(cross.body?.code).toBe(ErrorCode.NotFound);
    expect(JSON.stringify(cross.body)).not.toContain(keyA);

    const other = await json(baseUrl, 'GET', `/v1/documents/${docB}/download`, {
      token: await tokenFor(tokens, sessions, userB),
    });
    expect(other.status).toBe(200);
    expect(other.body?.downloadUrl).toBe(`memory://get/${keyB}`);
    expect(String(other.body?.downloadUrl)).not.toContain(projectA);
  });

  it('returns 404 on cross-project ids for status and both delete paths', async () => {
    const tokenB = await tokenFor(tokens, sessions, userB);
    const status = await json(baseUrl, 'GET', `/v1/documents/${docA}/status`, {
      token: tokenB,
    });
    const byId = await json(baseUrl, 'DELETE', `/v1/documents/${docA}`, { token: tokenB });
    const byProject = await json(
      baseUrl,
      'DELETE',
      `/v1/projects/${projectB}/documents/${docA}`,
      { token: tokenB },
    );
    expect(status.status).toBe(404);
    expect(byId.status).toBe(404);
    expect(byProject.status).toBe(404);
    expect(JSON.stringify(status.body)).not.toContain('Alpha secret');
  });

  it('lets a viewer read status but not delete, and tombstones without dropping the row id', async () => {
    const viewerToken = await tokenFor(tokens, sessions, viewerA);
    const status = await json(baseUrl, 'GET', `/v1/documents/${docFailed}/status`, {
      token: viewerToken,
    });
    expect(status.status).toBe(200);
    const denied = await json(baseUrl, 'DELETE', `/v1/documents/${docFailed}`, {
      token: viewerToken,
    });
    expect(denied.status).toBe(403);
    expect(denied.body?.code).toBe(ErrorCode.Forbidden);

    enqueue.enqueue.mockClear();
    const deleted = await json(baseUrl, 'DELETE', `/v1/documents/${docFailed}`, {
      token: await tokenFor(tokens, sessions, userA),
    });
    expect(deleted.status).toBe(204);
    expect(enqueue.enqueue).toHaveBeenCalledWith(
      'orphan-sweep',
      expect.objectContaining({ orgId: orgA }),
    );
    const gone = await json(baseUrl, 'GET', `/v1/documents/${docFailed}/status`, {
      token: await tokenFor(tokens, sessions, userA),
    });
    expect(gone.status).toBe(404);
    const row = (store.rows.get('document') ?? []).find((candidate) => candidate.id === docFailed);
    expect(row?.deletedAt).toBeDefined();
    expect(row).toBeDefined();
  });

  it('enqueues orphan-sweep from the project-scoped delete path', async () => {
    enqueue.enqueue.mockClear();
    const deleted = await json(
      baseUrl,
      'DELETE',
      `/v1/projects/${projectA}/documents/${docPartial}`,
      { token: await tokenFor(tokens, sessions, userA) },
    );
    expect(deleted.status).toBe(204);
    expect(enqueue.enqueue).toHaveBeenCalledWith(
      'orphan-sweep',
      expect.objectContaining({ orgId: orgA }),
    );
  });
});
