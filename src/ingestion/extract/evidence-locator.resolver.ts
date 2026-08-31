import { Inject, Injectable } from '@nestjs/common';
import {
  DOCUMENT_INGESTION_STORE,
  type DocumentBlockRecord,
  type DocumentIngestionStore,
} from '../../l0/ports/document-ingestion.port';

export interface EvidenceLocator {
  readonly documentVersionId: string;
  readonly blockId: string;
  readonly page: number;
}

export class EvidenceLocatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceLocatorError';
  }
}

/**
 * Resolves evidence locators to document_blocks of the same document version.
 * A locator's page must match the block's page.
 */
@Injectable()
export class EvidenceLocatorResolver {
  constructor(
    @Inject(DOCUMENT_INGESTION_STORE) private readonly store: DocumentIngestionStore,
  ) {}

  async resolve(locator: EvidenceLocator): Promise<DocumentBlockRecord> {
    const block = await this.store.getBlock(locator.blockId);
    if (block === null) {
      throw new EvidenceLocatorError(`Block "${locator.blockId}" was not found`);
    }

    if (block.documentVersionId !== locator.documentVersionId) {
      throw new EvidenceLocatorError(
        `Block "${locator.blockId}" does not belong to document version "${locator.documentVersionId}"`,
      );
    }

    if (block.page !== locator.page) {
      throw new EvidenceLocatorError(
        `Locator page ${String(locator.page)} does not match block page ${String(block.page)}`,
      );
    }

    return block;
  }
}
