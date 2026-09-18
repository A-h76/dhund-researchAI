import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  ExtractBlockInput,
  ExtractStore,
  ExtractVersionRecord,
  ExtractionRecord,
  DocumentBodyCapability,
  DocumentLifecycleStatus,
  StoredBlock,
} from '../../ports/extract-store.port';
import {
  allowedDocumentSources,
  DocumentTransitionError,
} from '../../ports/document-state';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaExtractStoreAdapter implements ExtractStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findVersion(documentVersionId: string): Promise<ExtractVersionRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().documentVersion.findUnique({
        where: { id: documentVersionId },
        select: {
          id: true,
          storageKey: true,
          versionNo: true,
          document: {
            select: {
              id: true,
              orgId: true,
              projectId: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        documentId: row.document.id,
        orgId: row.document.orgId,
        projectId: row.document.projectId,
        storageKey: row.storageKey,
        documentStatus: row.document.status,
        deletedAt: row.document.deletedAt,
        versionNo: row.versionNo,
      };
    } catch (error) {
      throw new L0OperationError('Document version lookup failed', error);
    }
  }

  async findExtraction(
    documentVersionId: string,
    extractorVersion: string,
    contentHash: string,
  ): Promise<ExtractionRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().documentExtraction.findUnique({
        where: {
          documentVersionId_extractorVersion_contentHash: {
            documentVersionId,
            extractorVersion,
            contentHash,
          },
        },
        select: {
          id: true,
          documentVersionId: true,
          extractorVersion: true,
          contentHash: true,
          status: true,
        },
      });
      if (row === null) {
        return null;
      }
      return row;
    } catch (error) {
      throw new L0OperationError('Document extraction lookup failed', error);
    }
  }

  async insertExtractionWithBlocks(input: {
    readonly extractionId: string;
    readonly documentVersionId: string;
    readonly extractorVersion: string;
    readonly contentHash: string;
    readonly blocks: readonly ExtractBlockInput[];
  }): Promise<'created' | 'existing'> {
    await this.database.connect();
    try {
      await this.client().$transaction(async (tx) => {
        await tx.documentExtraction.create({
          data: {
            id: input.extractionId,
            documentVersionId: input.documentVersionId,
            extractorVersion: input.extractorVersion,
            contentHash: input.contentHash,
            status: 'ok',
            producedAt: new Date(),
          },
        });
        if (input.blocks.length > 0) {
          await tx.documentBlock.createMany({
            data: input.blocks.map((block) => ({
              id: block.id,
              documentVersionId: input.documentVersionId,
              type: block.type,
              page: block.page,
              bbox:
                block.bbox === null
                  ? Prisma.JsonNull
                  : (block.bbox as unknown as Prisma.InputJsonValue),
              text: block.text,
              ordinal: block.ordinal,
            })),
          });
        }
      });
      return 'created';
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return 'existing';
      }
      throw new L0OperationError('Document extraction insert failed', error);
    }
  }

  async markDocumentStatus(documentId: string, status: DocumentLifecycleStatus): Promise<void> {
    await this.database.connect();
    try {
      const sources = allowedDocumentSources(status);
      const updated = await this.client().document.updateMany({
        where: { id: documentId, deletedAt: null, status: { in: [...sources] } },
        data: { status },
      });
      if (updated.count === 0) {
        const current = await this.client().document.findFirst({
          where: { id: documentId, deletedAt: null },
          select: { status: true },
        });
        if (current !== null) {
          throw new DocumentTransitionError(current.status, status);
        }
      }
    } catch (error) {
      if (error instanceof DocumentTransitionError) {
        throw error;
      }
      throw new L0OperationError('Document status update failed', error);
    }
  }

  async listBlocks(documentVersionId: string): Promise<readonly StoredBlock[]> {
    await this.database.connect();
    try {
      const rows = await this.client().documentBlock.findMany({
        where: { documentVersionId },
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          documentVersionId: true,
          page: true,
          ordinal: true,
          text: true,
        },
      });
      return rows;
    } catch (error) {
      throw new L0OperationError('Document block list failed', error);
    }
  }

  async findBlock(blockId: string): Promise<StoredBlock | null> {
    await this.database.connect();
    try {
      const row = await this.client().documentBlock.findUnique({
        where: { id: blockId },
        select: {
          id: true,
          documentVersionId: true,
          page: true,
          ordinal: true,
          text: true,
        },
      });
      return row;
    } catch (error) {
      throw new L0OperationError('Document block lookup failed', error);
    }
  }

  async bodyCapability(documentId: string): Promise<DocumentBodyCapability | null> {
    await this.database.connect();
    try {
      const row = await this.client().document.findFirst({
        where: { id: documentId, deletedAt: null },
        select: {
          rightsSnapshotId: true,
          rightsSnapshot: { select: { capabilities: true } },
        },
      });
      if (row === null) {
        return null;
      }
      if (row.rightsSnapshotId === null || row.rightsSnapshot === null) {
        return 'unrestricted';
      }
      return bodyGranted(row.rightsSnapshot.capabilities) ? 'allowed' : 'forbidden';
    } catch (error) {
      throw new L0OperationError('Document body-capability lookup failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function bodyGranted(capabilities: unknown): boolean {
  if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
    return false;
  }
  const body = (capabilities as { body?: unknown }).body;
  return body === true || body === 'true';
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
