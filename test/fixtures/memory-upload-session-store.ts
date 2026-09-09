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

interface StoredDocument {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly projectId: string;
  readonly storageKey: string;
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
    this.documents.push({
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      projectId: session.projectId,
      storageKey: session.storageKey,
    });
    const consumed = await this.transition(input.sessionId, 'uploaded', 'consumed');
    if (!consumed) {
      return null;
    }
    return {
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
    };
  }

  async findDocumentByStorageKey(
    projectId: string,
    storageKey: string,
  ): Promise<ConsumedUploadResult | null> {
    const row = this.documents.find(
      (entry) => entry.projectId === projectId && entry.storageKey === storageKey,
    );
    if (row === undefined) {
      return null;
    }
    return {
      documentId: row.documentId,
      documentVersionId: row.documentVersionId,
    };
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
