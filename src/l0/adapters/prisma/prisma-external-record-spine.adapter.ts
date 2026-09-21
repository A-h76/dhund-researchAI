import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  ExternalRecordRow,
  ExternalRecordSnapshotRow,
  ExternalRecordSpineStore,
  ExternalRecordTypeValue,
} from '../../ports/external-record-spine.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaExternalRecordSpineAdapter implements ExternalRecordSpineStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async getRecord(id: string): Promise<ExternalRecordRow | null> {
    await this.database.connect();
    const row = await this.client().externalRecord.findUnique({ where: { id } });
    return row === null ? null : toRecord(row);
  }

  async createRecord(input: {
    readonly id: string;
    readonly projectId: string;
    readonly connectorId: string;
    readonly externalId: string;
    readonly type: ExternalRecordTypeValue;
    readonly rightsSnapshotId: string;
    readonly linkedCanonicalWorkId?: string | null;
  }): Promise<ExternalRecordRow> {
    await this.database.connect();
    try {
      const row = await this.client().externalRecord.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          connectorId: input.connectorId,
          externalId: input.externalId,
          type: input.type,
          rightsSnapshotId: input.rightsSnapshotId,
          linkedCanonicalWorkId: input.linkedCanonicalWorkId ?? null,
        },
      });
      return toRecord(row);
    } catch (error) {
      throw new L0OperationError('external_record create failed', error);
    }
  }

  async getSnapshot(id: string): Promise<ExternalRecordSnapshotRow | null> {
    await this.database.connect();
    const row = await this.client().externalRecordSnapshot.findUnique({ where: { id } });
    return row === null ? null : toSnapshot(row);
  }

  async getLatestSnapshot(
    externalRecordId: string,
  ): Promise<ExternalRecordSnapshotRow | null> {
    await this.database.connect();
    const row = await this.client().externalRecordSnapshot.findFirst({
      where: { externalRecordId },
      orderBy: { capturedAt: 'desc' },
    });
    return row === null ? null : toSnapshot(row);
  }

  async appendSnapshot(input: {
    readonly id: string;
    readonly externalRecordId: string;
    readonly capturedAt: Date;
    readonly contentRef: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
  }): Promise<ExternalRecordSnapshotRow> {
    await this.database.connect();
    try {
      const row = await this.client().$transaction(async (tx) => {
        const created = await tx.externalRecordSnapshot.create({
          data: {
            id: input.id,
            externalRecordId: input.externalRecordId,
            capturedAt: input.capturedAt,
            contentRef: input.contentRef,
            metadata: input.metadata as Prisma.InputJsonValue,
          },
        });
        await tx.externalRecord.update({
          where: { id: input.externalRecordId },
          data: {
            lastCheckedAt: input.capturedAt,
            staleAt: null,
          },
        });
        return created;
      });
      return toSnapshot(row);
    } catch (error) {
      throw new L0OperationError('external_record_snapshot append failed', error);
    }
  }

  async markChecked(externalRecordId: string, checkedAt: Date): Promise<ExternalRecordRow> {
    await this.database.connect();
    const row = await this.client().externalRecord.update({
      where: { id: externalRecordId },
      data: {
        lastCheckedAt: checkedAt,
        staleAt: null,
      },
    });
    return toRecord(row);
  }

  async markStale(externalRecordId: string, staleAt: Date): Promise<ExternalRecordRow> {
    await this.database.connect();
    const row = await this.client().externalRecord.update({
      where: { id: externalRecordId },
      data: { staleAt },
    });
    return toRecord(row);
  }

  async softDelete(externalRecordId: string, deletedAt: Date): Promise<ExternalRecordRow> {
    await this.database.connect();
    const row = await this.client().externalRecord.update({
      where: { id: externalRecordId },
      data: { deletedAt },
    });
    return toRecord(row);
  }

  async getImportSession(id: string) {
    await this.database.connect();
    const row = await this.client().referenceManagerImportSession.findUnique({
      where: { id },
    });
    if (row === null) {
      return null;
    }
    return {
      id: row.id,
      projectId: row.projectId,
      source: row.source,
      initiatedBy: row.initiatedBy,
      state: row.state,
      itemsTotal: row.itemsTotal,
      itemsAdmitted: row.itemsAdmitted,
      itemsRejected: row.itemsRejected,
      idempotencyKey: row.idempotencyKey,
    };
  }

  async updateImportSession(input: {
    readonly id: string;
    readonly state: string;
    readonly itemsTotal?: number | null;
    readonly itemsAdmitted?: number;
    readonly itemsRejected?: number;
    readonly errors?: unknown;
    readonly terminalAt?: Date | null;
  }): Promise<void> {
    await this.database.connect();
    await this.client().referenceManagerImportSession.update({
      where: { id: input.id },
      data: {
        state: input.state as never,
        ...(input.itemsTotal !== undefined ? { itemsTotal: input.itemsTotal } : {}),
        ...(input.itemsAdmitted !== undefined ? { itemsAdmitted: input.itemsAdmitted } : {}),
        ...(input.itemsRejected !== undefined ? { itemsRejected: input.itemsRejected } : {}),
        ...(input.errors !== undefined
          ? { errors: input.errors as Prisma.InputJsonValue }
          : {}),
        ...(input.terminalAt !== undefined ? { terminalAt: input.terminalAt } : {}),
      },
    });
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function toRecord(row: {
  id: string;
  projectId: string;
  connectorId: string;
  externalId: string;
  type: string;
  linkedCanonicalWorkId: string | null;
  rightsSnapshotId: string;
  lastCheckedAt: Date | null;
  staleAt: Date | null;
  deletedAt: Date | null;
}): ExternalRecordRow {
  return {
    id: row.id,
    projectId: row.projectId,
    connectorId: row.connectorId,
    externalId: row.externalId,
    type: row.type as ExternalRecordTypeValue,
    linkedCanonicalWorkId: row.linkedCanonicalWorkId,
    rightsSnapshotId: row.rightsSnapshotId,
    lastCheckedAt: row.lastCheckedAt,
    staleAt: row.staleAt,
    deletedAt: row.deletedAt,
  };
}

function toSnapshot(row: {
  id: string;
  externalRecordId: string;
  capturedAt: Date;
  contentRef: string | null;
  metadata: unknown;
}): ExternalRecordSnapshotRow {
  return {
    id: row.id,
    externalRecordId: row.externalRecordId,
    capturedAt: row.capturedAt,
    contentRef: row.contentRef,
    metadata:
      typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}
