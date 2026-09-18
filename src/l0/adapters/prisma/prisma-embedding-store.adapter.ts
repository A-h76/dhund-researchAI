import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import {
  EMBEDDING_VECTOR_DIMENSION,
  EmbeddingDimensionMismatchError,
  type EmbeddableChunk,
  type EmbeddingInsert,
  type EmbeddingKey,
  type EmbeddingScopeQuery,
  type EmbeddingStore,
} from '../../ports/embedding-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

/**
 * chunk_embeddings is append-only and content-addressed. The adapter exposes no
 * update path: a changed vector is a new row under a new content hash or model
 * version, and two versions coexist on the unique key.
 */
@Injectable()
export class PrismaEmbeddingStoreAdapter implements EmbeddingStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findChunk(chunkId: string): Promise<EmbeddableChunk | null> {
    await this.database.connect();
    try {
      const row = await this.client().chunk.findFirst({
        where: { id: chunkId, documentVersion: { document: { deletedAt: null } } },
        select: {
          id: true,
          projectId: true,
          documentVersionId: true,
          contentHash: true,
          text: true,
          documentVersion: { select: { documentId: true } },
        },
      });
      return row === null ? null : toEmbeddableChunk(row);
    } catch (error) {
      throw new L0OperationError('Embedding chunk lookup failed', error);
    }
  }

  async listChunksInScope(query: EmbeddingScopeQuery): Promise<readonly EmbeddableChunk[]> {
    await this.database.connect();
    try {
      const rows = await this.client().chunk.findMany({
        where: {
          ...(query.projectIds !== null
            ? { projectId: { in: [...query.projectIds] } }
            : {}),
          documentVersion: {
            document: {
              orgId: query.orgId,
              deletedAt: null,
              ...(query.documentIds !== null ? { id: { in: [...query.documentIds] } } : {}),
            },
          },
        },
        orderBy: { id: 'asc' },
        ...(query.afterChunkId !== null
          ? { cursor: { id: query.afterChunkId }, skip: 1 }
          : {}),
        take: query.limit,
        select: {
          id: true,
          projectId: true,
          documentVersionId: true,
          contentHash: true,
          text: true,
          documentVersion: { select: { documentId: true } },
        },
      });
      return rows.map(toEmbeddableChunk);
    } catch (error) {
      throw new L0OperationError('Embedding scope list failed', error);
    }
  }

  async listEmbeddedKeys(
    modelVersion: string,
    chunkIds: readonly string[],
  ): Promise<readonly EmbeddingKey[]> {
    if (chunkIds.length === 0) {
      return [];
    }

    await this.database.connect();
    try {
      const rows = await this.client().chunkEmbedding.findMany({
        where: { modelVersion, chunkId: { in: [...chunkIds] }, status: 'ok' },
        select: { chunkId: true, contentHash: true },
      });
      return rows;
    } catch (error) {
      throw new L0OperationError('Embedding key list failed', error);
    }
  }

  async insertEmbeddings(rows: readonly EmbeddingInsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    // Refused before the statement is built — a wrong-width vector must never
    // reach the column, where it could be silently coerced.
    for (const row of rows) {
      assertSchemaDimension(row);
    }

    await this.database.connect();
    try {
      const values = rows.map(
        (row) => Prisma.sql`(
          ${row.id}::uuid,
          ${row.chunkId}::uuid,
          ${row.projectId}::uuid,
          ${row.modelId},
          ${row.modelVersion},
          ${row.vector.length},
          ${toVectorLiteral(row.vector)}::vector,
          ${row.contentHash},
          'ok'::embedding_status
        )`,
      );

      return await this.client().$executeRaw(Prisma.sql`
        INSERT INTO chunk_embeddings (
          id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ON CONSTRAINT chunk_embeddings_chunk_id_model_version_content_hash_key
        DO NOTHING
      `);
    } catch (error) {
      throw new L0OperationError('Embedding insert failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function assertSchemaDimension(row: EmbeddingInsert): void {
  if (row.vector.length !== EMBEDDING_VECTOR_DIMENSION) {
    throw new EmbeddingDimensionMismatchError(row.chunkId, row.vector.length);
  }
  for (const component of row.vector) {
    if (!Number.isFinite(component)) {
      throw new EmbeddingDimensionMismatchError(row.chunkId, row.vector.length);
    }
  }
}

function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

function toEmbeddableChunk(row: {
  id: string;
  projectId: string;
  documentVersionId: string;
  contentHash: string;
  text: string;
  documentVersion: { documentId: string };
}): EmbeddableChunk {
  return {
    chunkId: row.id,
    projectId: row.projectId,
    documentVersionId: row.documentVersionId,
    documentId: row.documentVersion.documentId,
    contentHash: row.contentHash,
    text: row.text,
  };
}
