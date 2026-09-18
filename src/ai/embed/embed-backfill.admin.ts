import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_EVENT,
  QUEUE_SERVICE,
  type AuditEventPort,
  type QueueService,
} from '../../l0/ports';
import { generateId } from '../../platform/ids/uuid-v7';
import { JobEnqueueService, requireCorrelationId } from '../../platform/logging';
import { deriveJobId } from '../../platform/queues/deterministic-job-id';
import {
  parseEmbedBackfillRequest,
  toEmbedBackfillJobPayload,
  type EmbedBackfillRequest,
} from './embed-backfill.payload';

export const EMBED_BACKFILL_AUDIT_ACTION = 'ingestion.embed_backfill.submitted';

export type EmbedBackfillSubmission =
  | { readonly kind: 'accepted'; readonly jobId: string; readonly batchId: string }
  | { readonly kind: 'duplicate'; readonly jobId: string; readonly batchId: string };

/**
 * GAP-ADMIN-JOB-01 — the sole producer for the embed-backfill queue. It is
 * operator-only: it is provided in the worker graph and no HTTP controller
 * reaches it, so no /v1 route can enqueue a backfill.
 *
 * Authorization is the operator identity carried on the submission itself; it
 * reads no cache and no access-context, so no authorization decision for this
 * job touches Redis.
 */
@Injectable()
export class EmbedBackfillAdminService {
  constructor(
    @Inject(AUDIT_EVENT) private readonly audit: AuditEventPort,
    @Inject(QUEUE_SERVICE) private readonly queue: QueueService,
    private readonly enqueue: JobEnqueueService,
  ) {}

  async submit(raw: unknown): Promise<EmbedBackfillSubmission> {
    const request = parseEmbedBackfillRequest(raw);
    const payload = toEmbedBackfillJobPayload(request);
    const jobId = deriveJobId('embed-backfill', payload);

    // The same (scope, modelVersion, batchId) resolves to the same job id, so a
    // repeat submission is a no-op: no second audit row, no second enqueue.
    const existing = await this.queue.getJobState('embed-backfill', jobId);
    if (existing !== null) {
      return { kind: 'duplicate', jobId, batchId: request.batchId };
    }

    await this.appendAudit(request);

    // Admission (global cap, interactive-lane fairness) runs inside enqueue,
    // before the job reaches the queue.
    const enqueuedJobId = await this.enqueue.enqueue('embed-backfill', payload);
    return { kind: 'accepted', jobId: enqueuedJobId, batchId: request.batchId };
  }

  private async appendAudit(request: EmbedBackfillRequest): Promise<void> {
    await this.audit.append({
      id: generateId(),
      actorType: 'user',
      actorId: request.operatorId,
      action: EMBED_BACKFILL_AUDIT_ACTION,
      scope: {
        orgId: request.orgId,
        operator: request.operatorId,
        scope: {
          allProjects: request.scope.allProjects,
          projects: [...request.scope.projects],
          documentIds: [...request.scope.documentIds],
        },
        modelVersion: request.modelVersion,
        batchId: request.batchId,
      },
      correlationId: requireCorrelationId(),
    });
  }
}
