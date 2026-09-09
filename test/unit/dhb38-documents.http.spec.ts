import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  Controller,
  Get,
  Headers,
  Param,
  type INestApplication,
} from '@nestjs/common';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { RequireAuth } from '../../src/iam/authorization/require-auth';
import {
  OBJECT_STORAGE_SERVICE,
  ORPHAN_SWEEP_STORE,
  SESSION_STORE,
  TENANCY_STORE,
  SCOPED_STORE,
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
import { DocumentsController } from '../../src/ingestion/documents.controller';
import { DocumentsRepository } from '../../src/ingestion/documents.repository';
import { DocumentsService } from '../../src/ingestion/documents.service';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';
import { MemoryTenancyStore } from '../fixtures/memory-tenancy-store';
import { MemoryScopedStore } from '../fixtures/memory-scoped-store';
import { tenancyGuardProviders } from '../fixtures/access-auth-providers';

@Controller('v1/projects/:projectId/documents-layer2')
class Layer2DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':documentId')
  @RequireAuth()
  get(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.documents.get(authorization, projectId, documentId);
  }
}

async function json(
  baseUrl: string,
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    [CORRELATION_ID_HEADER]: 'cor-dhb38-http',
    ...opts.headers,
  };
  if (opts.token !== undefined) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
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

describe('DHB-38 documents HTTP and Layer 2', () => {
  let app: INestApplication;
  let baseUrl: string;
  let store: MemoryScopedStore;
  let tokens: AccessTokenService;
  let sessions: MemorySessionStore;
  let projectA: string;
  let projectB: string;
  let userA: string;
  let userB: string;
  let docA: string;
  let docB: string;

  beforeAll(async () => {
    const jwt = generateTestJwtConfig();
    const config = installTestAppConfig({ jwt });
    sessions = new MemorySessionStore();
    const tenancy = new MemoryTenancyStore();
    store = new MemoryScopedStore();
    const orgA = generateId();
    const orgB = generateId();
    projectA = generateId();
    projectB = generateId();
    userA = generateId();
    userB = generateId();
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
      projectId: projectB,
      userId: userB,
      role: 'EDITOR',
    });

    docA = generateId();
    docB = generateId();
    const createdAt = new Date().toISOString();
    await store.insert('document', { projectId: projectA }, {
      id: docA,
      title: 'Alpha secret',
      status: 'queued',
      createdAt,
      storageKey: 'secret/a',
    });
    await store.insert('document', { projectId: projectB }, {
      id: docB,
      title: 'Beta',
      status: 'queued',
      createdAt,
      storageKey: 'secret/b',
    });

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as PlatformLogger;

    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentsController, Layer2DocumentsController],
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
        { provide: ORPHAN_SWEEP_STORE, useValue: { findLiveById: async () => null } },
        { provide: OBJECT_STORAGE_SERVICE, useValue: { getPresignedGetUrl: async () => 'memory://get' } },
        { provide: JobEnqueueService, useValue: { enqueue: async () => 'job-1' } },
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

  it('returns the caller-scoped document without storage fields', async () => {
    const response = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents/${docA}`,
      { token: await tokenFor(tokens, sessions, userA) },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: docA,
      projectId: projectA,
      title: 'Alpha secret',
    });
    expect(response.body).not.toHaveProperty('storageKey');
  });

  it('returns 404 with no foreign document data for IDOR', async () => {
    const token = await tokenFor(tokens, sessions, userB);
    const byId = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectB}/documents/${docA}`,
      { token },
    );
    const byProject = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents/${docA}`,
      { token },
    );
    expect(byId.status).toBe(404);
    expect(byId.body?.code).toBe(ErrorCode.NotFound);
    expect(JSON.stringify(byId.body)).not.toContain('Alpha secret');
    expect(byProject.status).toBe(404);
    expect(byProject.body?.code).toBe(ErrorCode.NotFound);
  });

  it('rejects limit above 100 with pagination_invalid', async () => {
    const response = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents?limit=101`,
      { token: await tokenFor(tokens, sessions, userA) },
    );
    expect(response.status).toBe(422);
    expect(response.body?.code).toBe(ErrorCode.PaginationInvalid);
  });

  it('round-trips a cursor and treats a forged foreign cursor as empty', async () => {
    const extra = generateId();
    await store.insert('document', { projectId: projectA }, {
      id: extra,
      title: 'Second',
      status: 'queued',
      createdAt: new Date().toISOString(),
    });
    const token = await tokenFor(tokens, sessions, userA);
    const first = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents?limit=1`,
      { token },
    );
    expect(first.status).toBe(200);
    expect(Array.isArray(first.body?.items)).toBe(true);
    expect((first.body?.items as unknown[]).length).toBe(1);
    expect(typeof first.body?.nextCursor).toBe('string');
    const second = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents?limit=1&cursor=${encodeURIComponent(String(first.body?.nextCursor))}`,
      { token },
    );
    expect(second.status).toBe(200);
    expect((second.body?.items as Array<{ id: string }>)[0]?.id).not.toBe(
      (first.body?.items as Array<{ id: string }>)[0]?.id,
    );

    const forged = encodeCursor(docA);
    const empty = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectB}/documents?cursor=${encodeURIComponent(forged)}`,
      { token: await tokenFor(tokens, sessions, userB) },
    );
    expect(empty.status).toBe(200);
    expect(empty.body?.items).toEqual([]);
    expect(JSON.stringify(empty.body)).not.toContain('Alpha secret');
  });

  it('keeps Layer 2 as 404 when the project-role guard is missing', async () => {
    const token = await tokenFor(tokens, sessions, userB);
    const crossProject = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectA}/documents-layer2/${docA}`,
      { token },
    );
    const sameProjectForeignId = await json(
      baseUrl,
      'GET',
      `/v1/projects/${projectB}/documents-layer2/${docA}`,
      { token },
    );
    expect(crossProject.status).toBe(404);
    expect(crossProject.body?.code).toBe(ErrorCode.NotFound);
    expect(sameProjectForeignId.status).toBe(404);
    expect(JSON.stringify(sameProjectForeignId.body)).not.toContain('Alpha secret');
  });
});
