import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  ChunkCharSpan,
  ChunkCommitInput,
  ChunkStore,
  ProjectChunk,
  StoredChunk,
} from '../../ports/chunk-store.port';
import type { ProjectScope } from '../../ports/scoped-store.port';
import {
  allowedDocumentSources,
  DocumentTransitionError,
} from '../../ports/document-state';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

/**
 * chunks.text is written exactly once at insert. This adapter intentionally
 * exposes no update path for chunk rows — the lexical projection is immutable.
 */
@Injectable()
export class PrismaChunkStoreAdapter implements ChunkStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async listChunks(
    documentVersionId: string,
    chunkerVersion: string,
  ): Promise<readonly StoredChunk[]> {
    await this.database.connect();
    try {
      const rows = await this.client().chunk.findMany({
        where: { documentVersionId, chunkerVersion },
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          documentVersionId: true,
          ordinal: true,
          charSpan: true,
          tokenCount: true,
          blockIds: true,
          contentHash: true,
          chunkerVersion: true,
          text: true,
        },
      });
      return rows.map((row) => ({
        ...row,
        charSpan: row.charSpan as unknown as ChunkCharSpan,
      }));
    } catch (error) {
      throw new L0OperationError('Chunk list failed', error);
    }
  }

  async listPriorVersionHashes(
    documentId: string,
    documentVersionId: string,
    chunkerVersion: string,
  ): Promise<readonly string[]> {
    await this.database.connect();
    try {
      const rows = await this.client().chunk.findMany({
        where: {
          chunkerVersion,
          documentVersionId: { not: documentVersionId },
          documentVersion: { documentId },
        },
        select: { contentHash: true },
        distinct: ['contentHash'],
      });
      return rows.map((row) => row.contentHash);
    } catch (error) {
      throw new L0OperationError('Chunk prior-version hash list failed', error);
    }
  }

  async commitChunks(input: ChunkCommitInput): Promise<void> {
    await this.database.connect();
    try {
      await this.client().$transaction(async (tx) => {
        if (input.chunks.length > 0) {
          await tx.chunk.createMany({
            data: input.chunks.map((chunk) => ({
              id: chunk.id,
              documentVersionId: chunk.documentVersionId,
              projectId: chunk.projectId,
              ordinal: chunk.ordinal,
              charSpan: chunk.charSpan as unknown as Prisma.InputJsonValue,
              tokenCount: chunk.tokenCount,
              page: chunk.page,
              section: chunk.section,
              blockIds: [...chunk.blockIds],
              contentHash: chunk.contentHash,
              chunkerVersion: chunk.chunkerVersion,
              text: chunk.text,
            })),
            skipDuplicates: true,
          });
        }

        if (input.toStatus !== null) {
          const sources = allowedDocumentSources(input.toStatus);
          const updated = await tx.document.updateMany({
            where: {
              id: input.documentId,
              deletedAt: null,
              status: { in: [...sources] },
            },
            data: { status: input.toStatus },
          });
          if (updated.count === 0) {
            const current = await tx.document.findFirst({
              where: { id: input.documentId, deletedAt: null },
              select: { status: true },
            });
            if (current !== null) {
              throw new DocumentTransitionError(current.status, input.toStatus);
            }
          }
        }

        for (const event of input.outboxEvents) {
          await tx.outbox.create({
            data: {
              id: event.id,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              eventType: event.eventType,
              schemaVersion: event.schemaVersion,
              payload: event.payload as Prisma.InputJsonValue,
              correlationId: event.correlationId,
            },
          });
        }
      });
    } catch (error) {
      if (error instanceof DocumentTransitionError) {
        throw error;
      }
      throw new L0OperationError('Chunk commit failed', error);
    }
  }

  async findInProject(
    scope: ProjectScope,
    chunkId: string,
  ): Promise<ProjectChunk | null> {
    await this.database.connect();
    try {
      const row = await this.client().chunk.findFirst({
        where: { id: chunkId, projectId: scope.projectId },
        select: {
          id: true,
          projectId: true,
          documentVersionId: true,
          text: true,
          blockIds: true,
          page: true,
          documentVersion: { select: { documentId: true } },
        },
      });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        projectId: row.projectId,
        documentId: row.documentVersion.documentId,
        documentVersionId: row.documentVersionId,
        text: row.text,
        blockIds: row.blockIds,
        page: row.page,
      };
    } catch (error) {
      throw new L0OperationError('Chunk project lookup failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}
