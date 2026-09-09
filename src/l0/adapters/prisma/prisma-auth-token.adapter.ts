import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type { OutboxTransaction } from '../../ports/outbox.port';
import type {
  AuthTokenInsert,
  AuthTokenStore,
  ConsumeOutcome,
} from '../../ports/auth-token-store.port';
import { unwrapOutboxTx } from './outbox-transaction';

@Injectable()
export class PrismaAuthTokenAdapter implements AuthTokenStore {
  async replaceOutstanding(
    tx: OutboxTransaction,
    record: AuthTokenInsert,
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.authToken.updateMany({
        where: {
          userId: record.userId,
          purpose: record.purpose,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      await prismaTx.authToken.create({
        data: {
          id: record.id,
          userId: record.userId,
          purpose: record.purpose,
          tokenHash: record.tokenHash,
          expiresAt: record.expiresAt,
        },
      });
    } catch (error) {
      throw new L0OperationError('Auth token persist failed', error);
    }
  }

  async consumeIfUnspent(
    tx: OutboxTransaction,
    input: {
      tokenHash: string;
      purpose: 'email_verification' | 'password_reset';
      now: Date;
    },
  ): Promise<ConsumeOutcome> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      const updated = await prismaTx.authToken.updateMany({
        where: {
          tokenHash: input.tokenHash,
          purpose: input.purpose,
          consumedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { consumedAt: input.now },
      });

      if (updated.count === 1) {
        const row = await prismaTx.authToken.findUnique({
          where: { tokenHash: input.tokenHash },
          include: {
            user: {
              select: {
                email: true,
                ownedOrganizations: {
                  where: { kind: 'PERSONAL' },
                  select: { id: true },
                  take: 1,
                },
                orgMemberships: {
                  where: { revokedAt: null },
                  select: { orgId: true },
                  take: 1,
                },
              },
            },
          },
        });
        if (row === null) {
          return { status: 'rejected' };
        }
        return {
          status: 'consumed',
          token: {
            id: row.id,
            userId: row.userId,
            email: row.user.email ?? '',
            orgId: resolveOrgId(row.user.ownedOrganizations, row.user.orgMemberships),
          },
        };
      }

      const existing = await prismaTx.authToken.findUnique({
        where: { tokenHash: input.tokenHash },
      });
      if (
        existing !== null &&
        existing.purpose === input.purpose &&
        existing.consumedAt === null &&
        existing.expiresAt <= input.now
      ) {
        return { status: 'expired' };
      }
      return { status: 'rejected' };
    } catch (error) {
      throw new L0OperationError('Auth token consume failed', error);
    }
  }

  async markEmailVerified(
    tx: OutboxTransaction,
    userId: string,
    verifiedAt: Date,
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: verifiedAt },
      });
    } catch (error) {
      throw new L0OperationError('Email verified persist failed', error);
    }
  }

  async updatePasswordHash(
    tx: OutboxTransaction,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.credential.update({
        where: { userId },
        data: { passwordHash },
      });
    } catch (error) {
      throw new L0OperationError('Password hash persist failed', error);
    }
  }
}

function resolveOrgId(
  ownedOrganizations: readonly { id: string }[],
  memberships: readonly { orgId: string }[],
): string | null {
  return ownedOrganizations[0]?.id ?? memberships[0]?.orgId ?? null;
}
