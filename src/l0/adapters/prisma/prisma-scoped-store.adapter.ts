import { Injectable } from '@nestjs/common';
import { EmbeddingDimensionMismatchError } from '../../ports/embedding-store.port';
import { L0OperationError } from '../../ports/errors';
import {
  HNSW_EF_SEARCH_DEFAULT,
  HNSW_WRITE_ACTIVE_MODEL_VERSION,
} from '../../ports/hnsw.constants';
import {
  assertQueryVectorDimension,
  resolveHnswEfSearch,
} from '../../ports/hnsw-ef-search';
import type {
  AnnHit,
  ProjectScope,
  ScopedListQuery,
  ScopedRow,
  ScopedStore,
  TenantEntity,
} from '../../ports/scoped-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

/**
 * GAP-HNSW-01: project_id is in WHERE before <=> so the planner can apply the
 * partial HNSW index (`idx_chunk_embeddings_hnsw_embedding_v1`) rather than
 * scanning another project's vectors. model_version + status match the
 * index predicate; they are not a second filter authority.
 */
export const ANN_NEAREST_SQL = `
SELECT ce.chunk_id AS "chunkId", ce.project_id AS "projectId"
FROM chunk_embeddings ce
WHERE ce.project_id = $1::uuid
  AND ce.model_version = '${HNSW_WRITE_ACTIVE_MODEL_VERSION}'
  AND ce.status = 'ok'
ORDER BY ce.vector <=> $2::vector(1024)
LIMIT $3
`.trim();

const SOFT_DELETE = new Set<TenantEntity>([
  'document',
  'claim',
  'conversation',
  'external_record',
]);

const DIRECT = new Set<TenantEntity>([
  'document',
  'evidence',
  'claim',
  'research_run',
  'conversation',
  'screening_decision',
  'external_record',
]);

interface ScopedDelegate {
  findFirst(args: object): Promise<Record<string, unknown> | null>;
  findMany(args: object): Promise<Array<Record<string, unknown>>>;
  updateMany(args: object): Promise<{ count: number }>;
  deleteMany(args: object): Promise<{ count: number }>;
  create(args: object): Promise<Record<string, unknown>>;
}

@Injectable()
export class PrismaScopedStoreAdapter implements ScopedStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async get(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
  ): Promise<ScopedRow | null> {
    await this.database.connect();
    try {
      const row = await this.findFirst(entity, scope, id);
      return row === null ? null : toRow(row, scope.projectId);
    } catch (error) {
      throw new L0OperationError('Scoped get failed', error);
    }
  }

  async update(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ScopedRow | null> {
    await this.database.connect();
    try {
      const updated = await this.delegate(entity).updateMany({
        where: this.where(entity, scope, id),
        data: sanitizePatch(patch),
      });
      if (updated.count === 0) {
        return null;
      }
      return this.get(entity, scope, id);
    } catch (error) {
      throw new L0OperationError('Scoped update failed', error);
    }
  }

  async delete(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
  ): Promise<boolean> {
    await this.database.connect();
    try {
      if (SOFT_DELETE.has(entity)) {
        const updated = await this.delegate(entity).updateMany({
          where: this.where(entity, scope, id),
          data: { deletedAt: new Date() },
        });
        return updated.count === 1;
      }
      const deleted = await this.delegate(entity).deleteMany({
        where: this.where(entity, scope, id),
      });
      return deleted.count === 1;
    } catch (error) {
      throw new L0OperationError('Scoped delete failed', error);
    }
  }

  async list(
    entity: TenantEntity,
    scope: ProjectScope,
    query: ScopedListQuery,
  ): Promise<readonly ScopedRow[]> {
    await this.database.connect();
    try {
      let afterId: string | undefined;
      if (query.afterId !== undefined) {
        const cursor = await this.findFirst(entity, scope, query.afterId);
        if (cursor === null) {
          return [];
        }
        afterId = query.afterId;
      }
      const include = this.include(entity);
      const rows = await this.delegate(entity).findMany({
        where: {
          ...this.where(entity, scope),
          ...(afterId === undefined ? {} : { id: { gt: afterId } }),
        },
        orderBy: { id: 'asc' },
        take: query.limit,
        ...(include === undefined ? {} : { include }),
      });
      return rows.map((row) =>
        toRow(row, projectIdOf(entity, row, scope.projectId)),
      );
    } catch (error) {
      throw new L0OperationError('Scoped list failed', error);
    }
  }

  async insert(
    entity: TenantEntity,
    scope: ProjectScope,
    row: Record<string, unknown>,
  ): Promise<ScopedRow> {
    await this.database.connect();
    try {
      const data = DIRECT.has(entity)
        ? { ...row, projectId: scope.projectId }
        : row;
      const include = this.include(entity);
      const created = await this.delegate(entity).create({
        data,
        ...(include === undefined ? {} : { include }),
      });
      return toRow(created, projectIdOf(entity, created, scope.projectId));
    } catch (error) {
      throw new L0OperationError('Scoped insert failed', error);
    }
  }

  async annNearest(
    scope: ProjectScope,
    vector: string,
    limit: number,
    options?: { readonly efSearch?: number },
  ): Promise<readonly AnnHit[]> {
    assertQueryVectorDimension(vector);
    const efSearch = resolveHnswEfSearch(options?.efSearch ?? HNSW_EF_SEARCH_DEFAULT);
    await this.database.connect();
    try {
      return await this.client().$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${String(efSearch)}`);
        return tx.$queryRawUnsafe<AnnHit[]>(
          ANN_NEAREST_SQL,
          scope.projectId,
          vector,
          limit,
        );
      });
    } catch (error) {
      if (error instanceof EmbeddingDimensionMismatchError) {
        throw error;
      }
      throw new L0OperationError('Scoped ANN failed', error);
    }
  }

  private async findFirst(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const include = this.include(entity);
    return this.delegate(entity).findFirst({
      where: this.where(entity, scope, id),
      ...(include === undefined ? {} : { include }),
    });
  }

  private where(
    entity: TenantEntity,
    scope: ProjectScope,
    id?: string,
  ): Record<string, unknown> {
    const deleted = SOFT_DELETE.has(entity) ? { deletedAt: null } : {};
    const idFilter = id === undefined ? {} : { id };
    if (entity === 'message') {
      return {
        ...idFilter,
        conversation: { projectId: scope.projectId, deletedAt: null },
      };
    }
    if (entity === 'extraction_cell') {
      return {
        ...idFilter,
        document: { projectId: scope.projectId, deletedAt: null },
      };
    }
    if (entity === 'research_artifact') {
      return { ...idFilter, run: { projectId: scope.projectId } };
    }
    return { ...idFilter, projectId: scope.projectId, ...deleted };
  }

  private include(entity: TenantEntity): object | undefined {
    if (entity === 'message') {
      return { conversation: { select: { projectId: true } } };
    }
    if (entity === 'extraction_cell') {
      return { document: { select: { projectId: true } } };
    }
    if (entity === 'research_artifact') {
      return { run: { select: { projectId: true } } };
    }
    return undefined;
  }

  private delegate(entity: TenantEntity): ScopedDelegate {
    const client = this.client();
    switch (entity) {
      case 'document':
        return client.document as unknown as ScopedDelegate;
      case 'evidence':
        return client.evidence as unknown as ScopedDelegate;
      case 'claim':
        return client.claim as unknown as ScopedDelegate;
      case 'research_run':
        return client.researchRun as unknown as ScopedDelegate;
      case 'extraction_cell':
        return client.extractionCell as unknown as ScopedDelegate;
      case 'conversation':
        return client.conversation as unknown as ScopedDelegate;
      case 'message':
        return client.message as unknown as ScopedDelegate;
      case 'research_artifact':
        return client.researchArtifact as unknown as ScopedDelegate;
      case 'screening_decision':
        return client.screeningDecision as unknown as ScopedDelegate;
      case 'external_record':
        return client.externalRecord as unknown as ScopedDelegate;
      default: {
        const exhaustive: never = entity;
        throw new L0OperationError(`Unknown scoped entity ${String(exhaustive)}`);
      }
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function sanitizePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const data = { ...patch };
  delete data.id;
  delete data.projectId;
  return data;
}

function projectIdOf(
  entity: TenantEntity,
  row: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof row.projectId === 'string') {
    return row.projectId;
  }
  if (entity === 'message') {
    const conversation = row.conversation as { projectId?: string } | undefined;
    return conversation?.projectId ?? fallback;
  }
  if (entity === 'extraction_cell') {
    const document = row.document as { projectId?: string } | undefined;
    return document?.projectId ?? fallback;
  }
  if (entity === 'research_artifact') {
    const run = row.run as { projectId?: string } | undefined;
    return run?.projectId ?? fallback;
  }
  return fallback;
}

function toRow(record: Record<string, unknown>, projectId: string): ScopedRow {
  const row: Record<string, unknown> = { ...record, projectId };
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      row[key] = value.toISOString();
    } else if (typeof value === 'bigint') {
      row[key] = value.toString();
    } else if (
      typeof value === 'object' &&
      value !== null &&
      'toNumber' in value &&
      typeof (value as { toNumber: unknown }).toNumber === 'function'
    ) {
      row[key] = (value as { toString: () => string }).toString();
    }
  }
  delete row.conversation;
  delete row.document;
  delete row.run;
  return row as ScopedRow;
}
