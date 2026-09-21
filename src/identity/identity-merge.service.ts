import { Inject, Injectable } from '@nestjs/common';
import {
  IDENTITY_SPINE_STORE,
  type IdentitySpineStore,
  type MergeCandidateSpineRecord,
} from '../l0/ports/identity-spine.port';
import { DomainError, ErrorCode } from '../platform/errors';
import {
  canTransitionMergeCandidate,
  MergeCandidateTransitionError,
} from './merge-candidate-state';
import { IdentityMetrics } from './identity.metrics';

const MODULE = 'identity';

export interface IdentityMergeJobPayload {
  readonly orgId: string;
  readonly correlationId: string;
  readonly mergeCandidateId: string;
  readonly decision: 'approve' | 'reject';
  readonly reviewedBy: string;
}

@Injectable()
export class IdentityMergeService {
  constructor(
    @Inject(IDENTITY_SPINE_STORE) private readonly spine: IdentitySpineStore,
    private readonly metrics: IdentityMetrics,
  ) {}

  async execute(payload: IdentityMergeJobPayload): Promise<MergeCandidateSpineRecord> {
    const candidate = await this.spine.getMergeCandidate(payload.mergeCandidateId);
    if (candidate === null) {
      throw new DomainError(ErrorCode.NotFound, { module: MODULE });
    }

    const toStatus = payload.decision === 'approve' ? 'merged' : 'rejected';
    if (!canTransitionMergeCandidate(candidate.status, toStatus)) {
      throw new MergeCandidateTransitionError(candidate.status, toStatus);
    }

    if (payload.decision === 'reject') {
      const rejected = await this.spine.transitionMergeCandidate({
        id: candidate.id,
        fromStatus: 'pending',
        toStatus: 'rejected',
        reviewedBy: payload.reviewedBy,
      });
      this.metrics.recordMergeRejected();
      return rejected;
    }

    // E-2: fuzzy_title may never merge — even under an approve job.
    if (candidate.matchType === 'fuzzy_title') {
      throw new DomainError(ErrorCode.Forbidden, {
        module: MODULE,
        serverDetail: 'fuzzy_title merge forbidden by honesty invariant (E-2)',
      });
    }

    const merged = await this.spine.mergeWorksUnderAudit({
      mergeCandidateId: candidate.id,
      reviewedBy: payload.reviewedBy,
    });
    this.metrics.recordMergeApproved();
    return merged;
  }
}
