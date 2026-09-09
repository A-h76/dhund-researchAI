import type { OutboxTransaction } from './outbox.port';

export interface LoginIdentity {
  readonly userId: string;
  readonly sessionVersion: number;
  readonly passwordHash: string | null;
  readonly orgId: string | null;
}

export interface AccessSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly revokedAt: Date | null;
  readonly userSessionVersion: number;
}

export interface RefreshFamilyRecord {
  readonly familyId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly currentTokenHash: string;
  readonly revokedAt: Date | null;
  readonly userSessionVersion: number;
  readonly orgId: string | null;
}

export interface SessionFamilyInsert {
  readonly sessionId: string;
  readonly familyId: string;
  readonly userId: string;
  readonly sessionVersion: number;
  readonly tokenHash: string;
  readonly issuedAt: Date;
}

export interface LogoutAllResult {
  readonly orgId: string | null;
  readonly sessionIds: readonly string[];
}

export interface SessionStore {
  findLoginByEmail(email: string): Promise<LoginIdentity | null>;
  getAccessSession(sessionId: string): Promise<AccessSession | null>;
  getRefreshFamily(familyId: string): Promise<RefreshFamilyRecord | null>;
  createSessionFamily(tx: OutboxTransaction, records: SessionFamilyInsert): Promise<void>;
  rotateFamilyHash(tx: OutboxTransaction, familyId: string, newHash: string): Promise<void>;
  revokeFamilyAndSession(
    tx: OutboxTransaction,
    input: { familyId: string; sessionId: string; reason: string },
  ): Promise<void>;
  logoutAll(tx: OutboxTransaction, userId: string, revokedAt: Date): Promise<LogoutAllResult>;
}
