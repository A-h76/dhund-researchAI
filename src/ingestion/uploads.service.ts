import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { readBearerToken } from '../iam/auth/parse-auth-request';
import { AccessContextService } from '../iam/authorization/access-context.service';
import { AccessTokenService } from '../iam/tokens/access-token.service';
import {
  L0ConnectionError,
  L0OperationError,
  OBJECT_STORAGE_SERVICE,
  TENANCY_STORE,
  UPLOAD_SESSION_STORE,
  type ObjectStorageService,
  type TenancyStore,
  type UploadSessionRecord,
  type UploadSessionStore,
  UploadConcurrencyError,
  UploadIdempotencyConflictError,
} from '../l0/ports';
import { authorizeProject } from '../platform/authorization/authorize';
import { UPLOAD_CONCURRENCY_DEFAULT } from '../platform/concurrency';
import { DomainError, ErrorCode, notFound } from '../platform/errors';
import { generateId, isUuid } from '../platform/ids/uuid-v7';
import { JobEnqueueService } from '../platform/logging';
import { projectScopeFrom } from '../platform/persistence/project-scope';
import {
  EXTRACTOR_VERSION,
  MAX_UPLOAD_BYTES,
  PRESIGN_TTL_SECONDS,
  UPLOAD_OBJECT_CATEGORY,
} from './upload.constants';
import { parseIdempotencyKey, parseUploadCreateRequest } from './parse-upload-request';
import { assertPdfMagicBytes, storedFilenameFromKey } from './upload-validation';
import { UploadsMetrics, type UploadRejectionClass } from './uploads.metrics';

const MODULE = 'ingestion';

export interface UploadSessionResponse {
  readonly sessionId: string;
  readonly status: UploadSessionRecord['status'];
  readonly expiresAt: string;
  readonly uploadUrl?: string;
}

export interface UploadCompleteResponse {
  readonly sessionId: string;
  readonly status: 'consumed';
  readonly documentId: string;
  readonly documentVersionId: string;
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly accessContext: AccessContextService,
    @Inject(TENANCY_STORE) private readonly tenancy: TenancyStore,
    @Inject(UPLOAD_SESSION_STORE) private readonly sessions: UploadSessionStore,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    private readonly enqueue: JobEnqueueService,
    private readonly metrics: UploadsMetrics,
  ) {}

  async create(
    authorization: string | undefined,
    projectId: string,
    body: unknown,
    idempotencyHeader: string | undefined,
  ): Promise<UploadSessionResponse> {
    try {
      const parsed = parseUploadCreateRequest(body);
      const idempotencyKey = parseIdempotencyKey(idempotencyHeader);
      const user = await this.accessTokens.verify(readBearerToken(authorization));
      const context = await this.accessContext.resolve(user.sub);
      projectScopeFrom(context, projectId, MODULE);
      const membership = context.projects.find((row) => row.projectId === projectId);
      if (membership === undefined) {
        throw notFound({ module: MODULE });
      }

      const fingerprint = requestFingerprint(parsed.filename, parsed.mimeType, parsed.sizeBytes);
      const scope = `upload:${projectId}`;
      const existing = await this.sessions.findIdempotency(scope, idempotencyKey);
      if (existing !== null) {
        if (existing.fingerprint !== fingerprint) {
          throw new DomainError(ErrorCode.IdempotencyKeyReused, { module: MODULE });
        }
        return this.presentIssued(existing.sessionId);
      }

      const sessionId = generateId();
      const storageKey = this.storage.generateObjectKey(
        membership.orgId,
        projectId,
        UPLOAD_OBJECT_CATEGORY,
        sessionId,
        parsed.filename,
      );
      const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000);
      let session: UploadSessionRecord;
      try {
        session = await this.sessions.insertIssued(
          {
            id: sessionId,
            projectId,
            orgId: membership.orgId,
            initiatedBy: user.sub,
            filename: storedFilenameFromKey(storageKey),
            sizeBytes: parsed.sizeBytes,
            mimeType: parsed.mimeType,
            storageKey,
            expiresAt,
            idempotencyScope: scope,
            idempotencyKey,
            requestFingerprint: fingerprint,
          },
          UPLOAD_CONCURRENCY_DEFAULT,
        );
      } catch (error) {
        if (error instanceof UploadConcurrencyError) {
          throw new DomainError(ErrorCode.ConcurrencyLimit, { module: MODULE });
        }
        if (error instanceof UploadIdempotencyConflictError) {
          const raced = await this.sessions.findIdempotency(scope, idempotencyKey);
          if (raced === null || raced.fingerprint !== fingerprint) {
            throw new DomainError(ErrorCode.IdempotencyKeyReused, { module: MODULE });
          }
          return this.presentIssued(raced.sessionId);
        }
        throwStorage(error);
      }

      this.metrics.recordCreated();
      const uploadUrl = await this.mintPutUrl(session);
      return toSessionResponse(session, uploadUrl);
    } catch (error) {
      this.recordRejection(error);
      throw error;
    }
  }

  async complete(
    authorization: string | undefined,
    sessionId: string,
  ): Promise<UploadCompleteResponse> {
    try {
      if (!isUuid(sessionId)) {
        throw notFound({ module: MODULE });
      }
      const user = await this.accessTokens.verify(readBearerToken(authorization));
      const context = await this.accessContext.resolve(user.sub);
      const session = await this.sessions.getById(sessionId);
      if (session === null) {
        throw notFound({ module: MODULE });
      }
      const liveProject = await this.tenancy.findLiveProject(session.projectId);
      authorizeProject(context, session.projectId, liveProject, 'EDITOR', {
        module: MODULE,
      });

      if (session.status === 'consumed') {
        return this.replayConsumed(session);
      }
      if (session.status === 'failed') {
        throw new DomainError(ErrorCode.InvalidStateTransition, { module: MODULE });
      }
      if (session.status === 'expired' || session.expiresAt.getTime() <= Date.now()) {
        if (session.status === 'issued' || session.status === 'uploaded') {
          await this.sessions.transition(session.id, session.status, 'expired');
          this.metrics.recordExpired();
        }
        throw new DomainError(ErrorCode.SessionExpired, { module: MODULE });
      }
      if (session.status !== 'issued') {
        throw new DomainError(ErrorCode.InvalidStateTransition, { module: MODULE });
      }

      const stat = await this.readStat(session.storageKey);
      if (stat === null) {
        throw new DomainError(ErrorCode.UploadNotCompleted, { module: MODULE });
      }
      if (stat.contentLength > MAX_UPLOAD_BYTES || stat.contentLength > session.sizeBytes) {
        await this.sessions.transition(session.id, 'issued', 'failed');
        throw new DomainError(ErrorCode.FileTooLarge, { module: MODULE });
      }
      if (stat.contentLength < session.sizeBytes) {
        throw new DomainError(ErrorCode.UploadNotCompleted, { module: MODULE });
      }

      const bytes = await this.readBytes(session.storageKey, session.sizeBytes);
      if (bytes === null) {
        throw new DomainError(ErrorCode.UploadNotCompleted, { module: MODULE });
      }
      try {
        assertPdfMagicBytes(bytes, session.mimeType);
      } catch (error) {
        await this.sessions.transition(session.id, 'issued', 'failed');
        throw error;
      }

      const contentHash = sha256Hex(bytes);
      const consumed = await this.sessions.consume({
        sessionId: session.id,
        documentId: generateId(),
        documentVersionId: generateId(),
        title: session.filename,
      });
      if (consumed === null) {
        throw new DomainError(ErrorCode.InvalidStateTransition, { module: MODULE });
      }

      await this.enqueueExtract(session, consumed.documentVersionId, contentHash);
      this.metrics.recordCompleted();
      return {
        sessionId: session.id,
        status: 'consumed',
        documentId: consumed.documentId,
        documentVersionId: consumed.documentVersionId,
      };
    } catch (error) {
      this.recordRejection(error);
      throw error;
    }
  }

  private async presentIssued(sessionId: string): Promise<UploadSessionResponse> {
    const session = await this.sessions.getById(sessionId);
    if (session === null) {
      throw notFound({ module: MODULE });
    }
    if (session.status !== 'issued' || session.expiresAt.getTime() <= Date.now()) {
      return toSessionResponse(session);
    }
    const uploadUrl = await this.mintPutUrl(session);
    return toSessionResponse(session, uploadUrl);
  }

  private async replayConsumed(
    session: UploadSessionRecord,
  ): Promise<UploadCompleteResponse> {
    const document = await this.sessions.findDocumentByStorageKey(
      session.projectId,
      session.storageKey,
    );
    if (document === null) {
      throw new DomainError(ErrorCode.InvalidStateTransition, { module: MODULE });
    }
    const bytes = await this.readBytes(session.storageKey, session.sizeBytes);
    if (bytes !== null) {
      await this.enqueueExtract(session, document.documentVersionId, sha256Hex(bytes));
    }
    return {
      sessionId: session.id,
      status: 'consumed',
      documentId: document.documentId,
      documentVersionId: document.documentVersionId,
    };
  }

  private async mintPutUrl(session: UploadSessionRecord): Promise<string> {
    const remaining = Math.max(
      1,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
    );
    try {
      return await this.storage.getPresignedPutUrl(
        session.storageKey,
        remaining,
        session.sizeBytes,
      );
    } catch (error) {
      throwStorage(error);
    }
  }

  private async readStat(key: string) {
    try {
      return await this.storage.headObject(key);
    } catch (error) {
      throwStorage(error);
    }
  }

  private async readBytes(key: string, maxBytes: number) {
    try {
      return await this.storage.getObjectBytes(key, maxBytes);
    } catch (error) {
      throwStorage(error);
    }
  }

  private async enqueueExtract(
    session: UploadSessionRecord,
    documentVersionId: string,
    contentHash: string,
  ): Promise<void> {
    await this.enqueue.enqueue('extract', {
      orgId: session.orgId,
      projectId: session.projectId,
      documentVersionId,
      contentHash,
      extractorVersion: EXTRACTOR_VERSION,
    });
  }

  private recordRejection(error: unknown): void {
    const reason = rejectionClass(error);
    if (reason !== null) {
      this.metrics.recordRejected(reason);
    }
  }
}

function requestFingerprint(
  filename: string,
  mimeType: string,
  sizeBytes: number,
): string {
  return createHash('sha256')
    .update(`${filename}\n${mimeType}\n${String(sizeBytes)}`)
    .digest('hex');
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toSessionResponse(
  session: UploadSessionRecord,
  uploadUrl?: string,
): UploadSessionResponse {
  return {
    sessionId: session.id,
    status: session.status,
    expiresAt: session.expiresAt.toISOString(),
    ...(uploadUrl !== undefined ? { uploadUrl } : {}),
  };
}

function throwStorage(error: unknown): never {
  if (error instanceof L0ConnectionError || error instanceof L0OperationError) {
    throw new DomainError(ErrorCode.StorageUnavailable, { module: MODULE });
  }
  throw error;
}

function rejectionClass(error: unknown): UploadRejectionClass | null {
  if (!(error instanceof DomainError)) {
    return null;
  }
  switch (error.code) {
    case ErrorCode.InvalidFileType:
      return 'invalid_file_type';
    case ErrorCode.InvalidFilename:
      return 'invalid_filename';
    case ErrorCode.FileTooLarge:
      return 'file_too_large';
    case ErrorCode.MagicBytesMismatch:
      return 'magic_bytes_mismatch';
    case ErrorCode.UploadNotCompleted:
      return 'upload_not_completed';
    case ErrorCode.SessionExpired:
      return 'session_expired';
    case ErrorCode.ConcurrencyLimit:
      return 'concurrency_limit';
    case ErrorCode.StorageUnavailable:
      return 'storage_unavailable';
    case ErrorCode.InvalidStateTransition:
      return 'invalid_state_transition';
    case ErrorCode.IdempotencyKeyReused:
      return 'idempotency_key_reused';
    case ErrorCode.IdempotencyKeyRequired:
      return 'idempotency_key_required';
    default:
      return null;
  }
}
