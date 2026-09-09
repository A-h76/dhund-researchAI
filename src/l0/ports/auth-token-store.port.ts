import type { OutboxTransaction } from './outbox.port';

export type AuthTokenPurpose = 'email_verification' | 'password_reset';

export interface AuthTokenInsert {
  readonly id: string;
  readonly userId: string;
  readonly purpose: AuthTokenPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface ConsumedAuthToken {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly orgId: string | null;
}

export type ConsumeOutcome =
  | { readonly status: 'consumed'; readonly token: ConsumedAuthToken }
  | { readonly status: 'expired' }
  | { readonly status: 'rejected' };

export interface AuthTokenStore {
  replaceOutstanding(tx: OutboxTransaction, record: AuthTokenInsert): Promise<void>;
  consumeIfUnspent(
    tx: OutboxTransaction,
    input: { tokenHash: string; purpose: AuthTokenPurpose; now: Date },
  ): Promise<ConsumeOutcome>;
  markEmailVerified(tx: OutboxTransaction, userId: string, verifiedAt: Date): Promise<void>;
  updatePasswordHash(
    tx: OutboxTransaction,
    userId: string,
    passwordHash: string,
  ): Promise<void>;
}
