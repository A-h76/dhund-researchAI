export const UPLOAD_SESSION_STATUSES = [
  'issued',
  'uploaded',
  'consumed',
  'expired',
  'failed',
] as const;

export type UploadSessionStatus = (typeof UPLOAD_SESSION_STATUSES)[number];

export const UPLOAD_SESSION_TRANSITIONS: Readonly<
  Record<UploadSessionStatus, readonly UploadSessionStatus[]>
> = {
  issued: ['uploaded', 'expired', 'failed'],
  uploaded: ['consumed', 'failed', 'expired'],
  consumed: [],
  expired: [],
  failed: [],
};

export interface UploadSessionRecord {
  readonly id: string;
  readonly projectId: string;
  readonly orgId: string;
  readonly initiatedBy: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly status: UploadSessionStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface IssuedUploadSessionInput {
  readonly id: string;
  readonly projectId: string;
  readonly orgId: string;
  readonly initiatedBy: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly expiresAt: Date;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
}

export interface UploadIdempotencyHit {
  readonly sessionId: string;
  readonly fingerprint: string;
}

export interface ConsumedUploadResult {
  readonly documentId: string;
  readonly documentVersionId: string;
}

export interface ConsumeUploadInput {
  readonly sessionId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly title: string;
}

export class UploadConcurrencyError extends Error {
  constructor() {
    super('Upload concurrency limit reached');
    this.name = 'UploadConcurrencyError';
  }
}

export class UploadIdempotencyConflictError extends Error {
  constructor() {
    super('Upload idempotency key conflict');
    this.name = 'UploadIdempotencyConflictError';
  }
}

export function canTransitionUploadSession(
  from: UploadSessionStatus,
  to: UploadSessionStatus,
): boolean {
  return UPLOAD_SESSION_TRANSITIONS[from].includes(to);
}

export interface UploadSessionStore {
  findIdempotency(
    scope: string,
    key: string,
  ): Promise<UploadIdempotencyHit | null>;
  countIssued(orgId: string, now?: Date): Promise<number>;
  insertIssued(
    input: IssuedUploadSessionInput,
    maxIssued: number,
  ): Promise<UploadSessionRecord>;
  getById(id: string): Promise<UploadSessionRecord | null>;
  transition(
    id: string,
    from: UploadSessionStatus,
    to: UploadSessionStatus,
  ): Promise<boolean>;
  consume(input: ConsumeUploadInput): Promise<ConsumedUploadResult | null>;
  findDocumentByStorageKey(
    projectId: string,
    storageKey: string,
  ): Promise<ConsumedUploadResult | null>;
}
