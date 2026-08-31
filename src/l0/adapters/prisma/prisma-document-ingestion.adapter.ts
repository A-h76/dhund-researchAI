import { Injectable } from '@nestjs/common';
import type { DocumentBlockType, DocumentStatus, Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  CreateBlockInput,
  DocumentBlockKind,
  DocumentBlockRecord,
  DocumentExtractionRecord,
  DocumentIngestionStore,
  DocumentLifecycleStatus,
  DocumentVersionRecord,
} from '../../ports/document-ingestion.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

@Injectable()
export class PrismaDocumentIngestionAdapter implements DocumentIngestionStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async getVersionWithDocument(
    documentVersionId: string,
  ): Promise<DocumentVersionRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().documentVersion.findUnique({
        where: { id: documentVersionId },
        include: {
          document: {
            select: {
              id: true,
              orgId: true,
              projectId: true,
              title: true,
              status: true,
            },
          },
        },
      });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        documentId: row.documentId,
        storageKey: row.storageKey,
        versionNo: row.versionNo,
        document: {
          id: row.document.id,
          orgId: row.document.orgId,
          projectId: row.document.projectId,
          title: row.document.title,
          status: row.document.status as DocumentLifecycleStatus,
        },
      };
    } catch (error) {
      throw new L0OperationError('Failed to load document version', error);
    }
  }

  async findExtraction(
    documentVersionId: string,
    extractorVersion: string,
    contentHash: string,
  ): Promise<DocumentExtractionRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().documentExtraction.findUnique({
        where: {
          documentVersionId_extractorVersion_contentHash: {
            documentVersionId,
            extractorVersion,
            contentHash,
          },
        },
      });
      return row === null ? null : this.toExtraction(row);
    } catch (error) {
      throw new L0OperationError('Failed to find document extraction', error);
    }
  }

  async listBlocks(documentVersionId: string): Promise<readonly DocumentBlockRecord[]> {
    await this.ensureConnected();
    try {
      const rows = await this.client().documentBlock.findMany({
        where: { documentVersionId },
        orderBy: { ordinal: 'asc' },
      });
      return rows.map((row) => this.toBlock(row));
    } catch (error) {
      throw new L0OperationError('Failed to list document blocks', error);
    }
  }

  async getBlock(blockId: string): Promise<DocumentBlockRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().documentBlock.findUnique({ where: { id: blockId } });
      return row === null ? null : this.toBlock(row);
    } catch (error) {
      throw new L0OperationError('Failed to load document block', error);
    }
  }

  async createExtractionWithBlocks(input: {
    extractionId: string;
    documentVersionId: string;
    documentId: string;
    extractorVersion: string;
    contentHash: string;
    status: string;
    producedAt: Date;
    blocks: readonly CreateBlockInput[];
    documentStatus: DocumentLifecycleStatus;
  }): Promise<DocumentExtractionRecord> {
    await this.ensureConnected();
    try {
      const extraction = await this.client().$transaction(async (tx) => {
        const created = await tx.documentExtraction.create({
          data: {
            id: input.extractionId,
            documentVersionId: input.documentVersionId,
            extractorVersion: input.extractorVersion,
            contentHash: input.contentHash,
            status: input.status,
            producedAt: input.producedAt,
          },
        });

        if (input.blocks.length > 0) {
          await tx.documentBlock.createMany({
            data: input.blocks.map((block) => ({
              id: block.id,
              documentVersionId: input.documentVersionId,
              type: block.type as DocumentBlockType,
              page: block.page,
              text: block.text,
              ordinal: block.ordinal,
              ...(block.bbox !== undefined
                ? { bbox: block.bbox as Prisma.InputJsonValue }
                : {}),
              ...(block.parentBlockId !== undefined
                ? { parentBlockId: block.parentBlockId }
                : {}),
            })),
          });
        }

        await tx.document.update({
          where: { id: input.documentId },
          data: { status: input.documentStatus as DocumentStatus },
        });

        return created;
      });

      return this.toExtraction(extraction);
    } catch (error) {
      throw new L0OperationError('Failed to persist document extraction', error);
    }
  }

  async markDocumentStatus(
    documentId: string,
    status: DocumentLifecycleStatus,
  ): Promise<void> {
    await this.ensureConnected();
    try {
      await this.client().document.update({
        where: { id: documentId },
        data: { status: status as DocumentStatus },
      });
    } catch (error) {
      throw new L0OperationError('Failed to update document status', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }

  private async ensureConnected(): Promise<void> {
    await this.database.connect();
  }

  private toExtraction(row: {
    id: string;
    documentVersionId: string;
    extractorVersion: string;
    contentHash: string;
    status: string;
    producedAt: Date;
  }): DocumentExtractionRecord {
    return {
      id: row.id,
      documentVersionId: row.documentVersionId,
      extractorVersion: row.extractorVersion,
      contentHash: row.contentHash,
      status: row.status,
      producedAt: row.producedAt,
    };
  }

  private toBlock(row: {
    id: string;
    documentVersionId: string;
    type: DocumentBlockType;
    page: number;
    bbox: unknown;
    text: string;
    ordinal: number;
    parentBlockId: string | null;
  }): DocumentBlockRecord {
    return {
      id: row.id,
      documentVersionId: row.documentVersionId,
      type: row.type as DocumentBlockKind,
      page: row.page,
      bbox: row.bbox,
      text: row.text,
      ordinal: row.ordinal,
      parentBlockId: row.parentBlockId,
    };
  }
}
