import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type { AuditEventAppendInput, AuditEventPort } from '../../ports/audit-event.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaAuditEventAdapter implements AuditEventPort {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async append(input: AuditEventAppendInput): Promise<void> {
    try {
      await this.database.appendAuditEvent(input);
    } catch (error) {
      throw new L0OperationError('Audit event append failed', error);
    }
  }
}
