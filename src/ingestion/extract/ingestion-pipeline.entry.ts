import { Injectable } from '@nestjs/common';
import { JobEnqueueService } from '../../platform/logging/job-enqueue.service';
import { EXTRACTOR_VERSION } from './extract.constants';

export interface AdmitExtractInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly documentVersionId: string;
  readonly contentHash: string;
}

/**
 * Sole ingestion pipeline entry that enqueues `extract` (DHB-50 / R9).
 * Discovery admission and Zotero import must call this — never enqueue extract elsewhere.
 */
@Injectable()
export class IngestionPipelineEntry {
  constructor(private readonly enqueue: JobEnqueueService) {}

  /**
   * Admit a document version into the single ingestion pipeline.
   * This is the only production call site that enqueues the extract queue.
   */
  async admitExtract(input: AdmitExtractInput): Promise<string> {
    return this.enqueue.enqueue('extract', {
      orgId: input.orgId,
      projectId: input.projectId,
      documentVersionId: input.documentVersionId,
      contentHash: input.contentHash,
      extractorVersion: EXTRACTOR_VERSION,
    });
  }
}
