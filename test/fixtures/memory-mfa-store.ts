import type { OutboxTransaction } from '../../src/l0/ports/outbox.port';
import type {
  MfaStore,
  RecoveryCodeInsert,
  TotpRecord,
} from '../../src/l0/ports/mfa-store.port';
import type { MemorySessionStore } from './memory-session-store';

interface StoredRecoveryCode {
  id: string;
  codeHash: string;
  consumedAt: Date | null;
}

export class MemoryMfaStore implements MfaStore {
  readonly totp = new Map<string, TotpRecord>();
  readonly recovery = new Map<string, StoredRecoveryCode[]>();

  constructor(private readonly sessions?: MemorySessionStore) {}

  async getTotp(userId: string): Promise<TotpRecord | null> {
    const found = this.totp.get(userId);
    return found === undefined ? null : { ...found, ciphertext: new Uint8Array(found.ciphertext) };
  }

  async upsertPendingTotp(
    _tx: OutboxTransaction,
    input: { id: string; userId: string; ciphertext: Uint8Array },
  ): Promise<void> {
    this.totp.set(input.userId, {
      userId: input.userId,
      ciphertext: new Uint8Array(input.ciphertext),
      enabledAt: null,
    });
    this.sessions?.setMfaEnabled(input.userId, false);
  }

  async enableTotp(
    _tx: OutboxTransaction,
    userId: string,
    enabledAt: Date,
  ): Promise<void> {
    const existing = this.totp.get(userId);
    if (existing === undefined) {
      return;
    }
    this.totp.set(userId, { ...existing, enabledAt });
    this.sessions?.setMfaEnabled(userId, true);
  }

  async disableTotp(_tx: OutboxTransaction, userId: string): Promise<void> {
    this.totp.delete(userId);
    this.recovery.delete(userId);
    this.sessions?.setMfaEnabled(userId, false);
  }

  async replaceRecoveryCodes(
    _tx: OutboxTransaction,
    userId: string,
    codes: readonly RecoveryCodeInsert[],
  ): Promise<void> {
    this.recovery.set(
      userId,
      codes.map((code) => ({
        id: code.id,
        codeHash: code.codeHash,
        consumedAt: null,
      })),
    );
  }

  async consumeRecoveryCode(
    _tx: OutboxTransaction,
    userId: string,
    codeHash: string,
    now: Date,
  ): Promise<'consumed' | 'rejected'> {
    const codes = this.recovery.get(userId);
    if (codes === undefined) {
      return 'rejected';
    }
    const match = codes.find((code) => code.codeHash === codeHash && code.consumedAt === null);
    if (match === undefined) {
      return 'rejected';
    }
    match.consumedAt = now;
    return 'consumed';
  }
}
