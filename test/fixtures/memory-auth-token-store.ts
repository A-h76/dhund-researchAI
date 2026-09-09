import type { OutboxTransaction } from '../../src/l0/ports/outbox.port';
import type {
  AuthTokenInsert,
  AuthTokenStore,
  ConsumeOutcome,
} from '../../src/l0/ports/auth-token-store.port';

interface StoredAuthToken {
  id: string;
  userId: string;
  purpose: AuthTokenInsert['purpose'];
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

interface StoredAuthUser {
  email: string;
  orgId: string | null;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
}

export class MemoryAuthTokenStore implements AuthTokenStore {
  readonly tokens = new Map<string, StoredAuthToken>();
  readonly users = new Map<string, StoredAuthUser>();
  failAfterConsume = false;

  seedUser(
    userId: string,
    user: StoredAuthUser,
  ): void {
    this.users.set(userId, { ...user });
  }

  async replaceOutstanding(
    _tx: OutboxTransaction,
    record: AuthTokenInsert,
  ): Promise<void> {
    const now = new Date();
    for (const [hash, token] of this.tokens.entries()) {
      if (
        token.userId === record.userId &&
        token.purpose === record.purpose &&
        token.consumedAt === null
      ) {
        this.tokens.set(hash, { ...token, consumedAt: now });
      }
    }
    this.tokens.set(record.tokenHash, {
      id: record.id,
      userId: record.userId,
      purpose: record.purpose,
      tokenHash: record.tokenHash,
      expiresAt: record.expiresAt,
      consumedAt: null,
    });
  }

  async consumeIfUnspent(
    _tx: OutboxTransaction,
    input: {
      tokenHash: string;
      purpose: AuthTokenInsert['purpose'];
      now: Date;
    },
  ): Promise<ConsumeOutcome> {
    const row = this.tokens.get(input.tokenHash);
    if (row === undefined || row.purpose !== input.purpose) {
      return { status: 'rejected' };
    }
    if (row.consumedAt !== null) {
      return { status: 'rejected' };
    }
    if (row.expiresAt <= input.now) {
      return { status: 'expired' };
    }

    const next = { ...row, consumedAt: input.now };
    this.tokens.set(input.tokenHash, next);
    if (this.failAfterConsume) {
      throw new Error('injected-verify-failure');
    }

    const user = this.users.get(row.userId);
    return {
      status: 'consumed',
      token: {
        id: row.id,
        userId: row.userId,
        email: user?.email ?? '',
        orgId: user?.orgId ?? null,
      },
    };
  }

  async markEmailVerified(
    _tx: OutboxTransaction,
    userId: string,
    verifiedAt: Date,
  ): Promise<void> {
    const user = this.users.get(userId);
    if (user === undefined || user.emailVerifiedAt !== null) {
      return;
    }
    this.users.set(userId, { ...user, emailVerifiedAt: verifiedAt });
  }

  async updatePasswordHash(
    _tx: OutboxTransaction,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    const user = this.users.get(userId);
    if (user === undefined) {
      return;
    }
    this.users.set(userId, { ...user, passwordHash });
  }
}
