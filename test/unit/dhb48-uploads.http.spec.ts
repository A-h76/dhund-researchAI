import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import {
  OBJECT_STORAGE_SERVICE,
  SESSION_STORE,
  TENANCY_STORE,
  UPLOAD_SESSION_STORE,
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
import { MAX_UPLOAD_BYTES } from '../../src/ingestion/upload.constants';
import { UploadsController } from '../../src/ingestion/uploads.controller';
import { UploadsMetrics } from '../../src/ingestion/uploads.metrics';
import { UploadsService } from '../../src/ingestion/uploads.service';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';
import { MemoryTenancyStore } from '../fixtures/memory-tenancy-store';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';
import { MemoryUploadSessionStore } from '../fixtures/memory-upload-session-store';
import { tenancyGuardProviders } from '../fixtures/access-auth-providers';

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
    [CORRELATION_ID_HEADER]: 'cor-dhb48-http',
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

function pdfOf(size: number): Buffer {
  const header = Buffer.from('%PDF-1.4\n');
  if (size <= header.length) {
    const out = Buffer.alloc(size, 0x20);
    Buffer.from('%PDF').copy(out);
    return out;
  }
  return Buffer.concat([header, Buffer.alloc(size - header.length, 0x20)]);
}

function keyFromPutUrl(url: string): string {
  return url.slice('memory://put/'.length);
}

describe('DHB-48 upload HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: AccessTokenService;
  let sessions: MemorySessionStore;
  let uploads: MemoryUploadSessionStore;
  let storage: MemoryObjectStorage;
  let projectA: string;
  let projectB: string;
  let userA: string;
  let userB: string;
  let viewer: string;
  let enqueue: { enqueue: jest.Mock };

  beforeAll(async () => {
    const jwt = generateTestJwtConfig();
    const config = installTestAppConfig({ jwt });
    sessions = new MemorySessionStore();
    const tenancy = new MemoryTenancyStore();
    uploads = new MemoryUploadSessionStore();
    storage = new MemoryObjectStorage();
    enqueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    const orgA = generateId();
    const orgB = generateId();
    projectA = generateId();
    projectB = generateId();
    userA = generateId();
    userB = generateId();
    viewer = generateId();
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
      userId: viewer,
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
      userId: viewer,
      role: 'VIEWER',
    });
    tenancy.seedProjectMembership({
      id: generateId(),
      projectId: projectB,
      userId: userB,
      role: 'EDITOR',
    });

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as PlatformLogger;

    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        UploadsService,
        UploadsMetrics,
        AccessTokenService,
        ...tenancyGuardProviders(),
        { provide: APP_CONFIG, useValue: config },
        { provide: SESSION_STORE, useValue: sessions },
        { provide: TENANCY_STORE, useValue: tenancy },
        { provide: UPLOAD_SESSION_STORE, useValue: uploads },
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

  beforeEach(() => {
    uploads.reset();
    storage.objects.clear();
    storage.failPuts = false;
    storage.failReads = false;
    enqueue.enqueue.mockClear();
  });

  it('creates a session, completes after a valid PUT, and enqueues extract', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    const created = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token,
        headers: { 'idempotency-key': `key-${generateId()}` },
        body: {
          filename: 'paper.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 24,
        },
      },
    );
    expect(created.status).toBe(201);
    expect(created.body?.status).toBe('issued');
    const uploadUrl = String(created.body?.uploadUrl);
    const key = keyFromPutUrl(uploadUrl);
    expect(key.startsWith(key.split('/')[0] ?? '')).toBe(true);
    expect(key).toContain(`/${projectA}/uploads/`);
    expect(key).not.toContain('..');
    storage.put(key, pdfOf(24));
    const completed = await json(
      baseUrl,
      'POST',
      `/v1/uploads/${String(created.body?.sessionId)}/complete`,
      { token },
    );
    expect(completed.status).toBe(200);
    expect(completed.body?.status).toBe('consumed');
    expect(typeof completed.body?.documentId).toBe('string');
    expect(enqueue.enqueue).toHaveBeenCalled();
  });

  it('forbids VIEWER from creating an upload session', async () => {
    const response = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token: await tokenFor(tokens, sessions, viewer),
        headers: { 'idempotency-key': `view-${generateId()}` },
        body: {
          filename: 'paper.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 16,
        },
      },
    );
    expect(response.status).toBe(403);
    expect(response.body?.code).toBe(ErrorCode.Forbidden);
  });

  it('returns the original session for a repeated Idempotency-Key', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    const key = `idem-${generateId()}`;
    const body = {
      filename: 'dup.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 16,
    };
    const first = await json(baseUrl, 'POST', `/v1/projects/${projectA}/uploads`, {
      token,
      headers: { 'idempotency-key': key },
      body,
    });
    const second = await json(baseUrl, 'POST', `/v1/projects/${projectA}/uploads`, {
      token,
      headers: { 'idempotency-key': key },
      body,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body?.sessionId).toBe(first.body?.sessionId);
  });

  it('requires Idempotency-Key and rejects reuse with a different body', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    const missing = await json(baseUrl, 'POST', `/v1/projects/${projectA}/uploads`, {
      token,
      body: {
        filename: 'paper.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 16,
      },
    });
    expect(missing.status).toBe(400);
    expect(missing.body?.code).toBe(ErrorCode.IdempotencyKeyRequired);

    const key = `reuse-${generateId()}`;
    const first = await json(baseUrl, 'POST', `/v1/projects/${projectA}/uploads`, {
      token,
      headers: { 'idempotency-key': key },
      body: {
        filename: 'one.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 16,
      },
    });
    expect(first.status).toBe(201);
    const reused = await json(baseUrl, 'POST', `/v1/projects/${projectA}/uploads`, {
      token,
      headers: { 'idempotency-key': key },
      body: {
        filename: 'two.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 16,
      },
    });
    expect(reused.status).toBe(409);
    expect(reused.body?.code).toBe(ErrorCode.IdempotencyKeyReused);
  });

  it('rejects invalid MIME, oversize, and path-traversal-into-key', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    const mime = await json(baseUrl, 'POST', `/v1/projects/${projectA}/uploads`, {
      token,
      headers: { 'idempotency-key': `mime-${generateId()}` },
      body: {
        filename: 'x.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 16,
      },
    });
    expect(mime.status).toBe(400);
    expect(mime.body?.code).toBe(ErrorCode.InvalidFileType);

    const oversize = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token,
        headers: { 'idempotency-key': `size-${generateId()}` },
        body: {
          filename: 'big.pdf',
          mimeType: 'application/pdf',
          sizeBytes: MAX_UPLOAD_BYTES + 1,
        },
      },
    );
    expect(oversize.status).toBe(413);
    expect(oversize.body?.code).toBe(ErrorCode.FileTooLarge);

    const traversal = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token,
        headers: { 'idempotency-key': `path-${generateId()}` },
        body: {
          filename: '../../etc/passwd',
          mimeType: 'application/pdf',
          sizeBytes: 16,
        },
      },
    );
    expect(traversal.status).toBe(201);
    const stored = uploads.sessions.get(String(traversal.body?.sessionId));
    expect(stored?.storageKey).toContain(`/${projectA}/uploads/`);
    expect(stored?.storageKey.endsWith('/passwd')).toBe(true);
    expect(stored?.storageKey).not.toContain('..');
    expect(stored?.filename).toBe('passwd');
  });

  it('rejects magic-byte contradiction and missing objects without creating documents', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    const created = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token,
        headers: { 'idempotency-key': `magic-${generateId()}` },
        body: {
          filename: 'fake.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 16,
        },
      },
    );
    const key = keyFromPutUrl(String(created.body?.uploadUrl));
    storage.put(key, Buffer.alloc(16, 0x41));
    const magic = await json(
      baseUrl,
      'POST',
      `/v1/uploads/${String(created.body?.sessionId)}/complete`,
      { token },
    );
    expect(magic.status).toBe(400);
    expect(magic.body?.code).toBe(ErrorCode.MagicBytesMismatch);
    expect(uploads.documentCount()).toBe(0);

    const missing = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token,
        headers: { 'idempotency-key': `miss-${generateId()}` },
        body: {
          filename: 'gone.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 16,
        },
      },
    );
    const notDone = await json(
      baseUrl,
      'POST',
      `/v1/uploads/${String(missing.body?.sessionId)}/complete`,
      { token },
    );
    expect(notDone.status).toBe(409);
    expect(notDone.body?.code).toBe(ErrorCode.UploadNotCompleted);
    expect((await uploads.getById(String(missing.body?.sessionId)))?.status).toBe(
      'issued',
    );
  });

  it('returns 404 for a cross-project complete and keeps the URL namespaced', async () => {
    const tokenA = await tokenFor(tokens, sessions, userA);
    const created = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token: tokenA,
        headers: { 'idempotency-key': `xproj-${generateId()}` },
        body: {
          filename: 'ns.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 16,
        },
      },
    );
    const key = keyFromPutUrl(String(created.body?.uploadUrl));
    expect(key).toContain(`/${projectA}/`);
    expect(key).not.toContain(projectB);
    const asB = await json(
      baseUrl,
      'POST',
      `/v1/uploads/${String(created.body?.sessionId)}/complete`,
      { token: await tokenFor(tokens, sessions, userB) },
    );
    expect(asB.status).toBe(404);
    expect(asB.body?.code).toBe(ErrorCode.NotFound);
    expect(JSON.stringify(asB.body)).not.toContain(key);
  });

  it('keeps the session issued with no document when object storage is unavailable', async () => {
    storage.failPuts = true;
    const before = uploads.sessions.size;
    const response = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token: await tokenFor(tokens, sessions, userA),
        headers: { 'idempotency-key': `down-${generateId()}` },
        body: {
          filename: 'down.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 16,
        },
      },
    );
    storage.failPuts = false;
    expect(response.status).toBe(503);
    expect(response.body?.code).toBe(ErrorCode.StorageUnavailable);
    expect(uploads.sessions.size).toBe(before + 1);
    const issued = [...uploads.sessions.values()].filter(
      (row) => row.filename === 'down.pdf',
    );
    expect(issued[0]?.status).toBe('issued');
    expect(uploads.documentCount()).toBe(0);
  });

  it('caps concurrent issued sessions at five per org', async () => {
    const token = await tokenFor(tokens, sessions, userA);
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await json(
        baseUrl,
        'POST',
        `/v1/projects/${projectA}/uploads`,
        {
          token,
          headers: { 'idempotency-key': `conc-${generateId()}` },
          body: {
            filename: `c${String(index)}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 16,
          },
        },
      );
      statuses.push(response.status);
    }
    expect(statuses.filter((status) => status === 201)).toHaveLength(5);
    expect(statuses[5]).toBe(403);
    const limited = await json(
      baseUrl,
      'POST',
      `/v1/projects/${projectA}/uploads`,
      {
        token,
        headers: { 'idempotency-key': `conc-overflow-${generateId()}` },
        body: {
          filename: 'overflow.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 16,
        },
      },
    );
    expect(limited.status).toBe(403);
    expect(limited.body?.code).toBe(ErrorCode.ConcurrencyLimit);
  });
});
