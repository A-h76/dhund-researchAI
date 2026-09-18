import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type {
  MessageEvidenceBindingInsert,
  MessageEvidenceBindingStore,
  StoredMessageEvidenceBinding,
} from '../../ports/message-evidence-binding.port';
import type { ProjectScope } from '../../ports/scoped-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaMessageEvidenceBindingAdapter implements MessageEvidenceBindingStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async insertMany(
    scope: ProjectScope,
    rows: readonly MessageEvidenceBindingInsert[],
  ): Promise<readonly StoredMessageEvidenceBinding[]> {
    if (rows.length === 0) {
      return [];
    }
    await this.database.connect();
    try {
      const evidenceIds = [...new Set(rows.map((row) => row.evidenceId))];
      const live = await this.client().evidence.findMany({
        where: {
          projectId: scope.projectId,
          id: { in: evidenceIds },
          supersededById: null,
        },
        select: { id: true },
      });
      if (live.length !== evidenceIds.length) {
        throw new L0OperationError(
          'Message evidence binding rejected: evidence missing or cross-project',
        );
      }
      for (const row of rows) {
        if (row.projectId !== scope.projectId) {
          throw new L0OperationError(
            'Message evidence binding rejected: project scope mismatch',
          );
        }
      }
      await this.client().messageEvidenceBinding.createMany({
        data: rows.map((row) => ({
          id: row.id,
          messageId: row.messageId,
          evidenceId: row.evidenceId,
          projectId: row.projectId,
        })),
      });
      return rows.map((row) => ({
        id: row.id,
        messageId: row.messageId,
        evidenceId: row.evidenceId,
        projectId: row.projectId,
      }));
    } catch (error) {
      if (error instanceof L0OperationError) {
        throw error;
      }
      throw new L0OperationError('Message evidence binding insert failed', error);
    }
  }

  async listForMessage(
    scope: ProjectScope,
    messageId: string,
  ): Promise<readonly StoredMessageEvidenceBinding[]> {
    await this.database.connect();
    try {
      const rows = await this.client().messageEvidenceBinding.findMany({
        where: { messageId, projectId: scope.projectId },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          messageId: true,
          evidenceId: true,
          projectId: true,
        },
      });
      return rows;
    } catch (error) {
      throw new L0OperationError('Message evidence binding list failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}
