import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { LIBRARY_STORE, SESSION_STORE, TENANCY_STORE } from '../../src/l0/ports';
import { APP_CONFIG } from '../../src/platform/config';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { CORRELATION_ID_HEADER } from '../../src/platform/errors/error-envelope';
import { GlobalExceptionFilter } from '../../src/platform/errors/global-exception.filter';
import { correlationExpressMiddleware, PlatformLogger } from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { LibraryController } from '../../src/ingestion/library.controller';
import { LibraryMetrics } from '../../src/ingestion/library.metrics';
import { LibraryService } from '../../src/ingestion/library.service';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemoryLibraryStore } from '../fixtures/memory-library-store';
import { MemorySessionStore } from '../fixtures/memory-session-store';
import { MemoryTenancyStore } from '../fixtures/memory-tenancy-store';
import { tenancyGuardProviders } from '../fixtures/access-auth-providers';

async function json(
  baseUrl: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    [CORRELATION_ID_HEADER]: 'cor-dhb72-http',
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

describe('DHB-72 library HTTP roles', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: AccessTokenService;
  let sessions: MemorySessionStore;
  let projectId: string;
  let ownerId: string;
  let editorId: string;
  let viewerId: string;
  let documentId: string;
  let foreignDocumentId: string;

  beforeAll(async () => {
    const config = installTestAppConfig({ jwt: generateTestJwtConfig() });
    sessions = new MemorySessionStore();
    const tenancy = new MemoryTenancyStore();
    const store = new MemoryLibraryStore();
    const orgId = generateId();
    const otherOrgId = generateId();
    projectId = generateId();
    const otherProjectId = generateId();
    ownerId = generateId();
    editorId = generateId();
    viewerId = generateId();
    documentId = generateId();
    foreignDocumentId = generateId();
    tenancy.seedOrg({ id: orgId, kind: 'TEAM', name: 'Org', ownerUserId: null });
    tenancy.seedOrg({ id: otherOrgId, kind: 'TEAM', name: 'Other', ownerUserId: null });
    tenancy.seedProject({ id: projectId, orgId, name: 'Home', settings: {} });
    tenancy.seedProject({ id: otherProjectId, orgId: otherOrgId, name: 'Away', settings: {} });
    for (const userId of [ownerId, editorId, viewerId]) {
      tenancy.seedOrgMembership({
        id: generateId(),
        orgId,
        userId,
        role: 'MEMBER',
      });
    }
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId: ownerId,
      role: 'OWNER',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId: editorId,
      role: 'EDITOR',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId,
      userId: viewerId,
      role: 'VIEWER',
    });
    store.seedDocument({
      id: documentId,
      projectId,
      title: 'Listed',
      authors: ['Ada'],
      year: 1843,
      storageKey: 'objects/listed.pdf',
    });
    store.seedDocument({
      id: foreignDocumentId,
      projectId: otherProjectId,
      title: 'Foreign secret',
      authors: [],
      year: null,
      storageKey: 'objects/foreign.pdf',
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [LibraryController],
      providers: [
        LibraryService,
        LibraryMetrics,
        AccessTokenService,
        ...tenancyGuardProviders(),
        { provide: APP_CONFIG, useValue: config },
        { provide: SESSION_STORE, useValue: sessions },
        { provide: TENANCY_STORE, useValue: tenancy },
        { provide: LIBRARY_STORE, useValue: store },
        {
          provide: PlatformLogger,
          useValue: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
        },
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

  it('returns 403 for an editor folder delete and a viewer item delete', async () => {
    const editor = await tokenFor(tokens, sessions, editorId);
    const viewer = await tokenFor(tokens, sessions, viewerId);
    const created = await json(baseUrl, 'POST', `/v1/projects/${projectId}/library/folders`, {
      token: editor,
      body: { name: 'Shelf' },
    });
    expect(created.status).toBe(201);
    const folderId = String(created.body?.id);
    const item = await json(baseUrl, 'POST', `/v1/projects/${projectId}/library/items`, {
      token: editor,
      body: { documentId, folderId },
    });
    expect(item.status).toBe(201);
    const itemId = String(item.body?.id);
    expect(item.body).not.toHaveProperty('downloadUrl');
    expect(JSON.stringify(item.body)).not.toContain('objects/listed.pdf');

    const viewerDelete = await json(
      baseUrl,
      'DELETE',
      `/v1/projects/${projectId}/library/items/${itemId}`,
      { token: viewer },
    );
    expect(viewerDelete.status).toBe(403);
    expect(viewerDelete.body?.code).toBe(ErrorCode.Forbidden);

    const editorDelete = await json(
      baseUrl,
      'DELETE',
      `/v1/projects/${projectId}/library/folders/${folderId}`,
      { token: editor },
    );
    expect(editorDelete.status).toBe(403);
    expect(editorDelete.body?.code).toBe(ErrorCode.Forbidden);

    const owner = await tokenFor(tokens, sessions, ownerId);
    const removed = await json(
      baseUrl,
      'DELETE',
      `/v1/projects/${projectId}/library/folders/${folderId}`,
      { token: owner },
    );
    expect(removed.status).toBe(204);
    expect(removed.body).toBeNull();

    const listed = await json(baseUrl, 'GET', `/v1/projects/${projectId}/library/items`, {
      token: editor,
    });
    const items = listed.body?.items as Array<{ id: string; folderId: string | null }>;
    expect(items.find((row) => row.id === itemId)?.folderId).toBeNull();
  });

  it('returns 404, not 422, for a cross-project documentId', async () => {
    const editor = await tokenFor(tokens, sessions, editorId);
    const response = await json(baseUrl, 'POST', `/v1/projects/${projectId}/library/items`, {
      token: editor,
      body: { documentId: foreignDocumentId },
    });
    expect(response.status).toBe(404);
    expect(response.body?.code).toBe(ErrorCode.NotFound);
    expect(JSON.stringify(response.body)).not.toContain('Foreign secret');
  });
});
