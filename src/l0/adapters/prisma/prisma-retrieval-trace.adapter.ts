import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type { ProjectScope } from '../../ports/scoped-store.port';
import type {
  RetrievalTracePersistInput,
  RetrievalTraceStore,
  StoredRetrievalTrace,
} from '../../ports/retrieval-trace.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaRetrievalTraceAdapter implements RetrievalTraceStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async persist(input: RetrievalTracePersistInput): Promise<StoredRetrievalTrace> {
    await this.database.connect();
    try {
      const row = await this.database.getPrismaClient().retrievalTrace.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          queryFingerprint: input.queryFingerprint,
          embeddingModel: input.embeddingModel,
          embeddingVersion: input.embeddingVersion,
          k: input.k,
          overFetchFactor: input.overFetchFactor,
          efSearch: input.efSearch,
          fallbacksUsed: input.fallbacksUsed as Prisma.InputJsonValue,
          body: input.body as Prisma.InputJsonValue,
        },
      });
      return toStored(row);
    } catch (error) {
      throw new L0OperationError('Retrieval trace persist failed', error);
    }
  }

  async findLatestByFingerprint(
    scope: ProjectScope,
    fingerprint: string,
  ): Promise<StoredRetrievalTrace | null> {
    await this.database.connect();
    try {
      const row = await this.database.getPrismaClient().retrievalTrace.findFirst({
        where: { projectId: scope.projectId, queryFingerprint: fingerprint },
        orderBy: { createdAt: 'desc' },
      });
      return row === null ? null : toStored(row);
    } catch (error) {
      throw new L0OperationError('Retrieval trace lookup failed', error);
    }
  }
}

function toStored(row: {
  readonly id: string;
  readonly projectId: string;
  readonly queryFingerprint: string;
  readonly embeddingModel: string;
  readonly embeddingVersion: string;
  readonly k: number;
  readonly overFetchFactor: number;
  readonly efSearch: number;
  readonly fallbacksUsed: unknown;
  readonly body: unknown;
}): StoredRetrievalTrace {
  return {
    id: row.id,
    projectId: row.projectId,
    queryFingerprint: row.queryFingerprint,
    embeddingModel: row.embeddingModel,
    embeddingVersion: row.embeddingVersion,
    k: row.k,
    overFetchFactor: row.overFetchFactor,
    efSearch: row.efSearch,
    fallbacksUsed: asStringArray(row.fallbacksUsed),
    body: asRecord(row.body),
  };
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
