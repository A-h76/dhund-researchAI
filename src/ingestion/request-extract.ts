import type { JobEnqueueService } from '../platform/logging';
import { EXTRACTOR_VERSION } from './upload.constants';

/**
 * Sole ResearchRun/upload path onto the canonical extract chain (R9).
 * Orchestration must call this rather than enqueueing extract itself.
 */
export async function requestExtractJob(
  enqueue: JobEnqueueService,
  input: {
    readonly orgId: string;
    readonly projectId: string;
    readonly documentVersionId: string;
    readonly contentHash: string;
    readonly extractorVersion?: string;
  },
): Promise<string> {
  return enqueue.enqueue('extract', {
    orgId: input.orgId,
    projectId: input.projectId,
    documentVersionId: input.documentVersionId,
    contentHash: input.contentHash,
    extractorVersion: input.extractorVersion ?? EXTRACTOR_VERSION,
  });
}
