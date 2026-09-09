import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type { OutboxTransaction } from '../../ports/outbox.port';
import {
  RegistrationConflictError,
  type RegistrationRecords,
  type RegistrationStore,
} from '../../ports/registration-store.port';
import { unwrapOutboxTx } from './outbox-transaction';

@Injectable()
export class PrismaRegistrationAdapter implements RegistrationStore {
  async insert(tx: OutboxTransaction, records: RegistrationRecords): Promise<void> {
    const prismaTx = unwrapOutboxTx(tx);

    try {
      await prismaTx.user.create({
        data: {
          id: records.user.id,
          email: records.user.email,
          displayName: records.user.displayName,
          emailVerifiedAt: null,
        },
      });
      await prismaTx.credential.create({
        data: {
          id: records.credential.id,
          userId: records.credential.userId,
          passwordHash: records.credential.passwordHash,
        },
      });
      await prismaTx.organization.create({
        data: {
          id: records.organization.id,
          kind: 'PERSONAL',
          name: records.organization.name,
          ownerUserId: records.organization.ownerUserId,
        },
      });
      await prismaTx.orgMembership.create({
        data: {
          id: records.membership.id,
          orgId: records.membership.orgId,
          userId: records.membership.userId,
          role: 'OWNER',
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new RegistrationConflictError();
      }
      throw new L0OperationError('Registration persist failed', error);
    }
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === undefined || current === null) {
      return false;
    }

    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (code === 'P2002' || code === '23505') {
        return true;
      }
    }

    const message = current instanceof Error ? current.message : String(current);
    if (/23505|unique constraint failed|duplicate key/i.test(message)) {
      return true;
    }

    current = current instanceof Error ? current.cause : undefined;
  }

  return false;
}
