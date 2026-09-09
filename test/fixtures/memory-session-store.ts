import type { OutboxTransaction } from '../../src/l0/ports/outbox.port';
import type {
  AccessSession,
  LoginIdentity,
  LogoutAllResult,
  RefreshFamilyRecord,
  SessionFamilyInsert,
  SessionStore,
} from '../../src/l0/ports/session-store.port';

export class MemorySessionStore implements SessionStore {
  readonly usersByEmail = new Map<string, LoginIdentity>();
  readonly usersById = new Map<string, LoginIdentity>();
  readonly sessions = new Map<string, AccessSession>();
  readonly families = new Map<string, RefreshFamilyRecord>();

  seedUser(email: string, identity: LoginIdentity): void {
    const copy = { ...identity };
    this.usersByEmail.set(email.toLowerCase(), copy);
    this.usersById.set(identity.userId, copy);
  }

  async findLoginByEmail(email: string): Promise<LoginIdentity | null> {
    const found = this.usersByEmail.get(email.toLowerCase());
    return found === undefined ? null : { ...found };
  }

  async getAccessSession(sessionId: string): Promise<AccessSession | null> {
    const found = this.sessions.get(sessionId);
    return found === undefined ? null : { ...found };
  }

  async getRefreshFamily(familyId: string): Promise<RefreshFamilyRecord | null> {
    const found = this.families.get(familyId);
    return found === undefined ? null : { ...found };
  }

  async createSessionFamily(
    _tx: OutboxTransaction,
    records: SessionFamilyInsert,
  ): Promise<void> {
    this.sessions.set(records.sessionId, {
      sessionId: records.sessionId,
      userId: records.userId,
      revokedAt: null,
      userSessionVersion: records.sessionVersion,
    });
    const user = this.usersById.get(records.userId);
    this.families.set(records.familyId, {
      familyId: records.familyId,
      userId: records.userId,
      sessionId: records.sessionId,
      currentTokenHash: records.tokenHash,
      revokedAt: null,
      userSessionVersion: records.sessionVersion,
      orgId: user?.orgId ?? null,
    });
  }

  async rotateFamilyHash(
    _tx: OutboxTransaction,
    familyId: string,
    newHash: string,
  ): Promise<void> {
    const family = this.families.get(familyId);
    if (family === undefined) {
      return;
    }
    this.families.set(familyId, { ...family, currentTokenHash: newHash });
  }

  async revokeFamilyAndSession(
    _tx: OutboxTransaction,
    input: { familyId: string; sessionId: string; reason: string },
  ): Promise<void> {
    const revokedAt = new Date();
    const family = this.families.get(input.familyId);
    if (family !== undefined) {
      this.families.set(input.familyId, { ...family, revokedAt });
    }
    const session = this.sessions.get(input.sessionId);
    if (session !== undefined) {
      this.sessions.set(input.sessionId, { ...session, revokedAt });
    }
  }

  async logoutAll(
    _tx: OutboxTransaction,
    userId: string,
    revokedAt: Date,
    _reason: string,
  ): Promise<LogoutAllResult> {
    const user = this.usersById.get(userId);
    const nextVersion = (user?.sessionVersion ?? 0) + 1;
    if (user !== undefined) {
      const next = { ...user, sessionVersion: nextVersion };
      this.usersById.set(userId, next);
      for (const [email, identity] of this.usersByEmail.entries()) {
        if (identity.userId === userId) {
          this.usersByEmail.set(email, next);
        }
      }
    }

    const sessionIds: string[] = [];
    for (const [id, session] of this.sessions.entries()) {
      if (session.userId === userId && session.revokedAt === null) {
        sessionIds.push(id);
        this.sessions.set(id, {
          ...session,
          revokedAt,
          userSessionVersion: nextVersion,
        });
      }
    }
    for (const [id, family] of this.families.entries()) {
      if (family.userId === userId && family.revokedAt === null) {
        this.families.set(id, { ...family, revokedAt });
      }
    }

    return { orgId: user?.orgId ?? null, sessionIds };
  }
}
