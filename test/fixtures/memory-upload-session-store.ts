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
} from '../../src/l0/ports/upload-session-store.port';

interface StoredDocumentVersion {
  readonly documentVersionId: string;
  readonly versionNo: number;
  readonly storageKey: string;
}

interface StoredDocument {
  readonly documentId: string;
  readonly projectId: string;
  readonly storageKey: string;
  readonly doi: string | null;
  status: string;
  readonly versions: StoredDocumentVersion[];
}

export class MemoryUploadSessionStore implements UploadSessionStore {
  readonly sessions = new Map<string, UploadSessionRecord>();
  readonly transitions: Array<{
    readonly id: string;
    readonly from: UploadSessionStatus;
    readonly to: UploadSessionStatus;
  }> = [];
  private readonly idempotency = new Map<string, UploadIdempotencyHit>();
  private readonly documents: StoredDocument[] = [];

  async findIdempotency(
    scope: string,
    key: string,
  ): Promise<UploadIdempotencyHit | null> {
    return this.idempotency.get(idempotencyKey(scope, key)) ?? null;
  }

  async countIssued(orgId: string, now: Date = new Date()): Promise<number> {
    return [...this.sessions.values()].filter(
      (row) =>
        row.orgId === orgId &&
        row.status === 'issued' &&
        row.expiresAt.getTime() > now.getTime(),
    ).length;
  }

  async insertIssued(
    input: IssuedUploadSessionInput,
    maxIssued: number,
  ): Promise<UploadSessionRecord> {
    const existing = this.idempotency.get(
      idempotencyKey(input.idempotencyScope, input.idempotencyKey),
    );
    if (existing !== undefined) {
      throw new UploadIdempotencyConflictError();
    }
    const issued = await this.countIssued(input.orgId);
    if (issued >= maxIssued) {
      throw new UploadConcurrencyError();
    }
    const record: UploadSessionRecord = {
      id: input.id,
      projectId: input.projectId,
      orgId: input.orgId,
      initiatedBy: input.initiatedBy,
      filename: input.filename,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      storageKey: input.storageKey,
      status: 'issued',
      createdAt: new Date(),
      expiresAt: input.expiresAt,
    };
    this.sessions.set(record.id, record);
    this.idempotency.set(idempotencyKey(input.idempotencyScope, input.idempotencyKey), {
      sessionId: record.id,
      fingerprint: input.requestFingerprint,
    });
    return record;
  }

  async getById(id: string): Promise<UploadSessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async transition(
    id: string,
    from: UploadSessionStatus,
    to: UploadSessionStatus,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (session === undefined || session.status !== from) {
      return false;
    }
    if (!canTransitionUploadSession(from, to)) {
      return false;
    }
    this.sessions.set(id, { ...session, status: to });
    this.transitions.push({ id, from, to });
    return true;
  }

  async consume(input: ConsumeUploadInput): Promise<ConsumedUploadResult | null> {
    const uploaded = await this.transition(input.sessionId, 'issued', 'uploaded');
    if (!uploaded) {
      return null;
    }
    const session = this.sessions.get(input.sessionId);
    if (session === undefined) {
      return null;
    }

    // GAP-DOI-OVERWRITE-01: same DOI + same project versions the existing
    // document; a different project gets its own document.
    const doi = input.doi ?? null;
    let result: ConsumedUploadResult;
    const existing =
      doi === null
        ? undefined
        : this.documents.find(
            (entry) => entry.projectId === session.projectId && entry.doi === doi,
          );
    if (existing !== undefined) {
      const nextVersionNo =
        Math.max(...existing.versions.map((version) => version.versionNo)) + 1;
      existing.versions.push({
        documentVersionId: input.documentVersionId,
        versionNo: nextVersionNo,
        storageKey: session.storageKey,
      });
      existing.status = 'stale';
      result = {
        documentId: existing.documentId,
        documentVersionId: input.documentVersionId,
      };
    } else {
      this.documents.push({
        documentId: input.documentId,
        projectId: session.projectId,
        storageKey: session.storageKey,
        doi,
        status: 'queued',
        versions: [
          {
            documentVersionId: input.documentVersionId,
            versionNo: 1,
            storageKey: session.storageKey,
          },
        ],
      });
      result = {
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
      };
    }

    const consumed = await this.transition(input.sessionId, 'uploaded', 'consumed');
    if (!consumed) {
      return null;
    }
    return result;
  }

  async findDocumentByStorageKey(
    projectId: string,
    storageKey: string,
  ): Promise<ConsumedUploadResult | null> {
    for (const entry of this.documents) {
      if (entry.projectId !== projectId) {
        continue;
      }
      const version = [...entry.versions]
        .sort((a, b) => b.versionNo - a.versionNo)
        .find((row) => row.storageKey === storageKey);
      if (version !== undefined) {
        return {
          documentId: entry.documentId,
          documentVersionId: version.documentVersionId,
        };
      }
    }
    return null;
  }

  documentsInProject(projectId: string): readonly StoredDocument[] {
    return this.documents.filter((entry) => entry.projectId === projectId);
  }

  expire(id: string, at: Date): void {
    const session = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    this.sessions.set(id, { ...session, expiresAt: at });
  }

  documentCount(): number {
    return this.documents.length;
  }

  reset(): void {
    this.sessions.clear();
    this.transitions.length = 0;
    this.idempotency.clear();
    this.documents.length = 0;
  }
}

function idempotencyKey(scope: string, key: string): string {
  return `${scope}\0${key}`;
}
