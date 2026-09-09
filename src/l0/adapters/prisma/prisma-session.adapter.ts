import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type { OutboxTransaction } from '../../ports/outbox.port';
import type {
  AccessSession,
  LoginIdentity,
  LogoutAllResult,
  RefreshFamilyRecord,
  SessionFamilyInsert,
  SessionStore,
} from '../../ports/session-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';
import { unwrapOutboxTx } from './outbox-transaction';

@Injectable()
export class PrismaSessionAdapter implements SessionStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findLoginByEmail(email: string): Promise<LoginIdentity | null> {
    await this.ensureConnected();
    try {
      const user = await this.client().user.findUnique({
        where: { email },
        include: {
          credential: true,
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
      });

      if (user === null || user.deletedAt !== null) {
        return null;
      }

      return {
        userId: user.id,
        sessionVersion: user.sessionVersion,
        passwordHash: user.credential?.passwordHash ?? null,
        orgId: resolveOrgId(user.ownedOrganizations, user.orgMemberships),
      };
    } catch (error) {
      throw new L0OperationError('Login lookup failed', error);
    }
  }

  async getAccessSession(sessionId: string): Promise<AccessSession | null> {
    await this.ensureConnected();
    try {
      const session = await this.client().session.findUnique({
        where: { id: sessionId },
        include: { user: { select: { id: true, sessionVersion: true, deletedAt: true } } },
      });

      if (session === null || session.user.deletedAt !== null) {
        return null;
      }

      return {
        sessionId: session.id,
        userId: session.userId,
        revokedAt: session.revokedAt,
        userSessionVersion: session.user.sessionVersion,
      };
    } catch (error) {
      throw new L0OperationError('Access session lookup failed', error);
    }
  }

  async getRefreshFamily(familyId: string): Promise<RefreshFamilyRecord | null> {
    await this.ensureConnected();
    try {
      const family = await this.client().refreshTokenFamily.findUnique({
        where: { id: familyId },
        include: {
          user: {
            select: {
              sessionVersion: true,
              deletedAt: true,
              ownedOrganizations: {
                where: { kind: 'PERSONAL' },
                select: { id: true },
                take: 1,
              },
              orgMemberships: {
                select: { orgId: true },
                take: 1,
              },
            },
          },
        },
      });

      if (family === null || family.user.deletedAt !== null) {
        return null;
      }

      return {
        familyId: family.id,
        userId: family.userId,
        sessionId: family.sessionId,
        currentTokenHash: family.currentTokenHash,
        revokedAt: family.revokedAt,
        userSessionVersion: family.user.sessionVersion,
        orgId: resolveOrgId(family.user.ownedOrganizations, family.user.orgMemberships),
      };
    } catch (error) {
      throw new L0OperationError('Refresh family lookup failed', error);
    }
  }

  async createSessionFamily(
    tx: OutboxTransaction,
    records: SessionFamilyInsert,
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.session.create({
        data: {
          id: records.sessionId,
          userId: records.userId,
          issuedAt: records.issuedAt,
          sessionVersion: records.sessionVersion,
        },
      });
      await prismaTx.refreshTokenFamily.create({
        data: {
          id: records.familyId,
          userId: records.userId,
          sessionId: records.sessionId,
          currentTokenHash: records.tokenHash,
          issuedAt: records.issuedAt,
        },
      });
    } catch (error) {
      throw new L0OperationError('Session persist failed', error);
    }
  }

  async rotateFamilyHash(
    tx: OutboxTransaction,
    familyId: string,
    newHash: string,
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      await prismaTx.refreshTokenFamily.update({
        where: { id: familyId },
        data: { currentTokenHash: newHash },
      });
    } catch (error) {
      throw new L0OperationError('Refresh rotation persist failed', error);
    }
  }

  async revokeFamilyAndSession(
    tx: OutboxTransaction,
    input: { familyId: string; sessionId: string; reason: string },
  ): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);
    const revokedAt = new Date();
    try {
      await prismaTx.refreshTokenFamily.update({
        where: { id: input.familyId },
        data: { revokedAt, revokedReason: input.reason },
      });
      await prismaTx.session.update({
        where: { id: input.sessionId },
        data: { revokedAt },
      });
    } catch (error) {
      throw new L0OperationError('Family revocation persist failed', error);
    }
  }

  async logoutAll(
    tx: OutboxTransaction,
    userId: string,
    revokedAt: Date,
  ): Promise<LogoutAllResult> {
    const prismaTx = unwrapOutboxTx(tx);
    try {
      const sessions = await prismaTx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true },
      });
      await prismaTx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      });
      await prismaTx.refreshTokenFamily.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt, revokedReason: 'logout_all' },
      });
      await prismaTx.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      });

      const user = await prismaTx.user.findUnique({
        where: { id: userId },
        select: {
          ownedOrganizations: {
            where: { kind: 'PERSONAL' },
            select: { id: true },
            take: 1,
          },
          orgMemberships: {
            select: { orgId: true },
            take: 1,
          },
        },
      });

      return {
        orgId: user
          ? resolveOrgId(user.ownedOrganizations, user.orgMemberships)
          : null,
        sessionIds: sessions.map((session) => session.id),
      };
    } catch (error) {
      throw new L0OperationError('Logout-all persist failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }

  private async ensureConnected(): Promise<void> {
    await this.database.connect();
  }
}

function resolveOrgId(
  ownedOrganizations: readonly { id: string }[],
  memberships: readonly { orgId: string }[],
): string | null {
  return ownedOrganizations[0]?.id ?? memberships[0]?.orgId ?? null;
}
