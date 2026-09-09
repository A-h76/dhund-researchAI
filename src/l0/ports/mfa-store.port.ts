import type { OutboxTransaction } from './outbox.port';

export interface TotpRecord {
  readonly userId: string;
  readonly ciphertext: Uint8Array;
  readonly enabledAt: Date | null;
}

export interface RecoveryCodeInsert {
  readonly id: string;
  readonly codeHash: string;
}

export interface MfaStore {
  getTotp(userId: string): Promise<TotpRecord | null>;
  upsertPendingTotp(
    tx: OutboxTransaction,
    input: { id: string; userId: string; ciphertext: Uint8Array },
  ): Promise<void>;
  enableTotp(tx: OutboxTransaction, userId: string, enabledAt: Date): Promise<void>;
  disableTotp(tx: OutboxTransaction, userId: string): Promise<void>;
  replaceRecoveryCodes(
    tx: OutboxTransaction,
    userId: string,
    codes: readonly RecoveryCodeInsert[],
  ): Promise<void>;
  consumeRecoveryCode(
    tx: OutboxTransaction,
    userId: string,
    codeHash: string,
    now: Date,
  ): Promise<'consumed' | 'rejected'>;
}
