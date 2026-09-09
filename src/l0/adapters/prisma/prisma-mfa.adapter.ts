import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type { OutboxTransaction } from '../../ports/outbox.port';
import type {
  MfaStore,
  RecoveryCodeInsert,
  TotpRecord,
} from '../../ports/mfa-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';
import { unwrapOutboxTx } from './outbox-transaction';

@Injectable()
export class PrismaMfaAdapter implements MfaStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async getTotp(userId: string): Promise<TotpRecord | null> {
    await this.database.connect();
    try {
      const row = await this.database.getPrismaClient().totpSecret.findUnique({
        where: { userId },
      });
      if (row === null) {
        return null;
      }
      return {
        userId: row.userId,
        ciphertext: new Uint8Array(row.secretCiphertext),
        enabledAt: row.enabledAt,
      };
    } catch (error) {
      throw new L0OperationError('TOTP lookup failed', error);
    }
  }

  async upsertPendingTotp(
    tx: OutboxTransaction,
    input: { id: string; userId: string; ciphertext: Uint8Array },
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.totpSecret.upsert({
        where: { userId: input.userId },
        create: {
          id: input.id,
          userId: input.userId,
          secretCiphertext: Buffer.from(input.ciphertext),
          enabledAt: null,
        },
        update: {
          secretCiphertext: Buffer.from(input.ciphertext),
          enabledAt: null,
        },
      });
    } catch (error) {
      throw new L0OperationError('TOTP persist failed', error);
    }
  }

  async enableTotp(
    tx: OutboxTransaction,
    userId: string,
    enabledAt: Date,
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.totpSecret.update({
        where: { userId },
        data: { enabledAt },
      });
    } catch (error) {
      throw new L0OperationError('TOTP enable persist failed', error);
    }
  }

  async disableTotp(tx: OutboxTransaction, userId: string): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await prismaTx.totpSecret.deleteMany({ where: { userId } });
    } catch (error) {
      throw new L0OperationError('TOTP disable persist failed', error);
    }
  }

  async replaceRecoveryCodes(
    tx: OutboxTransaction,
    userId: string,
    codes: readonly RecoveryCodeInsert[],
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.mfaRecoveryCode.deleteMany({ where: { userId } });
      if (codes.length === 0) {
        return;
      }
      await prismaTx.mfaRecoveryCode.createMany({
        data: codes.map((code) => ({
          id: code.id,
          userId,
          codeHash: code.codeHash,
        })),
      });
    } catch (error) {
      throw new L0OperationError('Recovery code persist failed', error);
    }
  }

  async consumeRecoveryCode(
    tx: OutboxTransaction,
    userId: string,
    codeHash: string,
    now: Date,
  ): Promise<'consumed' | 'rejected'> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      const updated = await prismaTx.mfaRecoveryCode.updateMany({
        where: { userId, codeHash, consumedAt: null },
        data: { consumedAt: now },
      });
      return updated.count === 1 ? 'consumed' : 'rejected';
    } catch (error) {
      throw new L0OperationError('Recovery code consume failed', error);
    }
  }
}
