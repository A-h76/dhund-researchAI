import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import {
  canTransitionUploadSession,
  UploadConcurrencyError,
  UploadIdempotencyConflictError,
  type ConsumeUploadInput,
  type ConsumedUploadResult,
  type IssuedUploadSessionInput,
  type UploadIdempotencyHit,
  type UploadSessionRecord,
  type UploadSessionStatus,
  type UploadSessionStore,
} from '../../ports/upload-session-store.port';
import { canTransitionDocument } from '../../ports/document-state';
import type { DocumentLifecycleStatus } from '../../ports/extract-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaUploadSessionAdapter implements UploadSessionStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findIdempotency(
    scope: string,
    key: string,
  ): Promise<UploadIdempotencyHit | null> {
    await this.database.connect();
    try {
      const row = await this.client().idempotencyRecord.findUnique({
        where: { scope_key: { scope, key } },
        select: { id: true, requestFingerprint: true },
      });
      if (row === null) {
        return null;
      }
      return { sessionId: row.id, fingerprint: row.requestFingerprint };
    } catch (error) {
      throw new L0OperationError('Upload idempotency lookup failed', error);
    }
  }

  async countIssued(orgId: string, now: Date = new Date()): Promise<number> {
    await this.database.connect();
    try {
      return await this.client().uploadSession.count({
        where: {
          orgId,
          status: 'issued',
          expiresAt: { gt: now },
        },
      });
    } catch (error) {
      throw new L0OperationError('Upload concurrency count failed', error);
    }
  }

  async insertIssued(
    input: IssuedUploadSessionInput,
    maxIssued: number,
  ): Promise<UploadSessionRecord> {
    await this.database.connect();
    try {
      const created = await this.client().$transaction(async (tx) => {
        const issued = await tx.uploadSession.count({
          where: {
            orgId: input.orgId,
            status: 'issued',
            expiresAt: { gt: new Date() },
          },
        });
        if (issued >= maxIssued) {
          throw new UploadConcurrencyError();
        }

        await tx.idempotencyRecord.create({
          data: {
            id: input.id,
            scope: input.idempotencyScope,
            key: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            responseHash: input.id,
          },
        });

        return tx.uploadSession.create({
          data: {
            id: input.id,
            projectId: input.projectId,
            orgId: input.orgId,
            initiatedBy: input.initiatedBy,
            filename: input.filename,
            sizeBytes: BigInt(input.sizeBytes),
            mimeType: input.mimeType,
            storageKey: input.storageKey,
            status: 'issued',
            expiresAt: input.expiresAt,
          },
        });
      });
      return toRecord(created);
    } catch (error) {
      if (error instanceof UploadConcurrencyError) {
        throw error;
      }
      if (isUniqueConstraintViolation(error)) {
        throw new UploadIdempotencyConflictError();
      }
      throw new L0OperationError('Upload session persist failed', error);
    }
  }

  async getById(id: string): Promise<UploadSessionRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().uploadSession.findUnique({
        where: { id },
      });
      return row === null ? null : toRecord(row);
    } catch (error) {
      throw new L0OperationError('Upload session lookup failed', error);
    }
  }

  async transition(
    id: string,
    from: UploadSessionStatus,
    to: UploadSessionStatus,
  ): Promise<boolean> {
    if (!canTransitionUploadSession(from, to)) {
      return false;
    }
    await this.database.connect();
    try {
      const updated = await this.client().uploadSession.updateMany({
        where: { id, status: from },
        data: { status: to },
      });
      return updated.count === 1;
    } catch (error) {
      throw new L0OperationError('Upload session transition failed', error);
    }
  }

  async consume(input: ConsumeUploadInput): Promise<ConsumedUploadResult | null> {
    await this.database.connect();
    try {
      return await this.client().$transaction(async (tx) => {
        const uploaded = await tx.uploadSession.updateMany({
          where: { id: input.sessionId, status: 'issued' },
          data: { status: 'uploaded' },
        });
        if (uploaded.count !== 1) {
          return null;
        }

        const session = await tx.uploadSession.findUnique({
          where: { id: input.sessionId },
        });
        if (session === null) {
          return null;
        }

        // GAP-DOI-OVERWRITE-01: same DOI in the same project versions the
        // existing document instead of forking a second one. The old version
        // and its chunks/embeddings remain; the document goes stale for the
        // old version. A different project always gets a separate document.
        const doi = input.doi ?? null;
        if (doi !== null) {
          const existingDocument = await tx.document.findFirst({
            where: { projectId: session.projectId, doi, deletedAt: null },
            select: {
              id: true,
              status: true,
              versions: {
                orderBy: { versionNo: 'desc' },
                take: 1,
                select: { versionNo: true },
              },
            },
          });
          if (existingDocument !== null) {
            const nextVersionNo = (existingDocument.versions[0]?.versionNo ?? 0) + 1;
            await tx.documentVersion.create({
              data: {
                id: input.documentVersionId,
                documentId: existingDocument.id,
                versionNo: nextVersionNo,
                storageKey: session.storageKey,
              },
            });
            if (
              canTransitionDocument(
                existingDocument.status as DocumentLifecycleStatus,
                'stale',
              )
            ) {
              await tx.document.updateMany({
                where: { id: existingDocument.id, deletedAt: null },
                data: { status: 'stale' },
              });
            }
            await tx.uploadSession.update({
              where: { id: input.sessionId },
              data: { status: 'consumed' },
            });
            return {
              documentId: existingDocument.id,
              documentVersionId: input.documentVersionId,
            };
          }
        }

        await tx.document.create({
          data: {
            id: input.documentId,
            projectId: session.projectId,
            orgId: session.orgId,
            title: input.title,
            authors: [],
            storageKey: session.storageKey,
            status: 'queued',
            doi,
          },
        });
        await tx.documentVersion.create({
          data: {
            id: input.documentVersionId,
            documentId: input.documentId,
            versionNo: 1,
            storageKey: session.storageKey,
          },
        });
        await tx.uploadSession.update({
          where: { id: input.sessionId },
          data: { status: 'consumed' },
        });
        return {
          documentId: input.documentId,
          documentVersionId: input.documentVersionId,
        };
      });
    } catch (error) {
      throw new L0OperationError('Upload consume failed', error);
    }
  }

  async findDocumentByStorageKey(
    projectId: string,
    storageKey: string,
  ): Promise<ConsumedUploadResult | null> {
    await this.database.connect();
    try {
      // Look up by the VERSION's storage key: on DOI re-ingest, later
      // versions carry their own storage keys distinct from the document's.
      const version = await this.client().documentVersion.findFirst({
        where: {
          storageKey,
          retiredAt: null,
          document: { projectId, deletedAt: null },
        },
        orderBy: { versionNo: 'desc' },
        select: { id: true, documentId: true },
      });
      if (version === null) {
        return null;
      }
      return { documentId: version.documentId, documentVersionId: version.id };
    } catch (error) {
      throw new L0OperationError('Upload document lookup failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function toRecord(row: {
  id: string;
  projectId: string;
  orgId: string;
  initiatedBy: string;
  filename: string;
  sizeBytes: bigint;
  mimeType: string;
  storageKey: string;
  status: UploadSessionStatus;
  createdAt: Date;
  expiresAt: Date;
}): UploadSessionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    orgId: row.orgId,
    initiatedBy: row.initiatedBy,
    filename: row.filename,
    sizeBytes: Number(row.sizeBytes),
    mimeType: row.mimeType,
    storageKey: row.storageKey,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === undefined || current === null) {
      return false;
    }
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (code === 'P2002' || code === '23505') {
        return true;
      }
    }
    const message = current instanceof Error ? current.message : String(current);
    if (/23505|unique constraint failed|duplicate key/i.test(message)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
