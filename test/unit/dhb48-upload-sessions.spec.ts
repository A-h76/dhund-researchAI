import { generateId } from '../../src/platform/ids/uuid-v7';
import {
  canTransitionUploadSession,
  UPLOAD_SESSION_STATUSES,
  UPLOAD_SESSION_TRANSITIONS,
} from '../../src/l0/ports/upload-session-store.port';
import { DomainError, ErrorCode } from '../../src/platform/errors';
import { JobEnqueueService } from '../../src/platform/logging';
import { UploadsService } from '../../src/ingestion/uploads.service';
import { UploadsMetrics } from '../../src/ingestion/uploads.metrics';
import { EXTRACTOR_VERSION } from '../../src/ingestion/upload.constants';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';
import { MemoryUploadSessionStore } from '../fixtures/memory-upload-session-store';
import type { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import type { AccessContextService } from '../../src/iam/authorization/access-context.service';
import type { TenancyStore } from '../../src/l0/ports';
import type { PlatformLogger } from '../../src/platform/logging';

function pdfOf(size: number): Buffer {
  const header = Buffer.from('%PDF-1.4\n');
  if (size <= header.length) {
    const out = Buffer.alloc(size, 0x20);
    Buffer.from('%PDF').copy(out);
    return out;
  }
  return Buffer.concat([header, Buffer.alloc(size - header.length, 0x20)]);
}

describe('DHB-48 UploadSession state machine', () => {
  const orgId = generateId();
  const projectId = generateId();
  const userId = generateId();
  let store: MemoryUploadSessionStore;
  let storage: MemoryObjectStorage;
  let enqueue: { enqueue: jest.Mock };
  let service: UploadsService;
  const auth = 'Bearer token';

  beforeEach(() => {
    store = new MemoryUploadSessionStore();
    storage = new MemoryObjectStorage();
    enqueue = { enqueue: jest.fn().mockResolvedValue('job-1') };
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as PlatformLogger;
    service = new UploadsService(
      {
        verify: async () => ({ sub: userId }),
      } as unknown as AccessTokenService,
      {
        resolve: async () => ({
          userId,
          orgs: [{ orgId, role: 'OWNER' }],
          projects: [{ projectId, orgId, role: 'EDITOR' }],
        }),
      } as unknown as AccessContextService,
      {
        findLiveProject: async (id: string) =>
          id === projectId
            ? { id: projectId, orgId, name: 'P', settings: {} }
            : null,
      } as unknown as TenancyStore,
      store,
      storage,
      enqueue as unknown as JobEnqueueService,
      new UploadsMetrics(logger),
    );
  });

  it('allows only the documented transitions', () => {
    expect(UPLOAD_SESSION_STATUSES).toEqual([
      'issued',
      'uploaded',
      'consumed',
      'expired',
      'failed',
    ]);
    expect(canTransitionUploadSession('issued', 'uploaded')).toBe(true);
    expect(canTransitionUploadSession('issued', 'expired')).toBe(true);
    expect(canTransitionUploadSession('issued', 'failed')).toBe(true);
    expect(canTransitionUploadSession('uploaded', 'consumed')).toBe(true);
    expect(canTransitionUploadSession('consumed', 'issued')).toBe(false);
    expect(canTransitionUploadSession('failed', 'consumed')).toBe(false);
    expect(canTransitionUploadSession('expired', 'issued')).toBe(false);
    expect(UPLOAD_SESSION_TRANSITIONS.consumed).toEqual([]);
  });

  it('creates an issued session and consumes it into a document plus extract job', async () => {
    const created = await service.create(
      auth,
      projectId,
      { filename: 'paper.pdf', mimeType: 'application/pdf', sizeBytes: 32 },
      'idem-1',
    );
    expect(created.status).toBe('issued');
    const key = created.uploadUrl?.slice('memory://put/'.length) ?? '';
    expect(key).toContain(`/${projectId}/uploads/`);
    storage.put(key, pdfOf(32));
    const completed = await service.complete(auth, created.sessionId);
    expect(completed.status).toBe('consumed');
    await expect(store.getById(created.sessionId)).resolves.toMatchObject({
      status: 'consumed',
    });
    expect(store.transitions.map((row) => `${row.from}:${row.to}`)).toEqual([
      'issued:uploaded',
      'uploaded:consumed',
    ]);
    expect(store.documentCount()).toBe(1);
    expect(enqueue.enqueue).toHaveBeenCalledWith(
      'extract',
      expect.objectContaining({
        orgId,
        projectId,
        documentVersionId: completed.documentVersionId,
        extractorVersion: EXTRACTOR_VERSION,
      }),
    );
  });

  it('marks magic-byte mismatches failed with no document', async () => {
    const created = await service.create(
      auth,
      projectId,
      { filename: 'paper.pdf', mimeType: 'application/pdf', sizeBytes: 16 },
      'idem-magic',
    );
    const key = created.uploadUrl?.slice('memory://put/'.length) ?? '';
    storage.put(key, Buffer.alloc(16, 0x00));
    try {
      await service.complete(auth, created.sessionId);
      throw new Error('expected reject');
    } catch (error) {
      expect((error as DomainError).code).toBe(ErrorCode.MagicBytesMismatch);
    }
    expect((await store.getById(created.sessionId))?.status).toBe('failed');
    expect(store.documentCount()).toBe(0);
    expect(store.transitions).toEqual([
      { id: created.sessionId, from: 'issued', to: 'failed' },
    ]);
  });

  it('expires an issued session on complete after TTL', async () => {
    const created = await service.create(
      auth,
      projectId,
      { filename: 'paper.pdf', mimeType: 'application/pdf', sizeBytes: 16 },
      'idem-exp',
    );
    store.expire(created.sessionId, new Date(Date.now() - 1000));
    try {
      await service.complete(auth, created.sessionId);
      throw new Error('expected reject');
    } catch (error) {
      expect((error as DomainError).code).toBe(ErrorCode.SessionExpired);
    }
    expect((await store.getById(created.sessionId))?.status).toBe('expired');
    expect(store.documentCount()).toBe(0);
  });

  it('leaves the session issued and creates no document when storage is down', async () => {
    storage.failPuts = true;
    try {
      await service.create(
        auth,
        projectId,
        { filename: 'paper.pdf', mimeType: 'application/pdf', sizeBytes: 16 },
        'idem-down',
      );
      throw new Error('expected reject');
    } catch (error) {
      expect((error as DomainError).code).toBe(ErrorCode.StorageUnavailable);
    }
    const rows = [...store.sessions.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('issued');
    expect(store.documentCount()).toBe(0);
  });

  it('rejects complete of a failed session', async () => {
    const created = await service.create(
      auth,
      projectId,
      { filename: 'paper.pdf', mimeType: 'application/pdf', sizeBytes: 16 },
      'idem-fail-complete',
    );
    await store.transition(created.sessionId, 'issued', 'failed');
    try {
      await service.complete(auth, created.sessionId);
      throw new Error('expected reject');
    } catch (error) {
      expect((error as DomainError).code).toBe(ErrorCode.InvalidStateTransition);
    }
  });
});
