import { Inject, Injectable } from '@nestjs/common';
import {
  IDENTITY_SPINE_STORE,
  type IdentitySpineStore,
  type MergeCandidateSpineRecord,
  type WorkBibliographicView,
} from '../l0/ports/identity-spine.port';
import { DomainError, ErrorCode } from '../platform/errors';

const MODULE = 'identity';

/**
 * Merge review DTO — bibliographic identity only (E-3).
 * Must never include project documents, evidence, notes, or memberships.
 */
export interface MergeReviewView {
  readonly mergeCandidateId: string;
  readonly matchType: MergeCandidateSpineRecord['matchType'];
  readonly status: MergeCandidateSpineRecord['status'];
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly candidateWork: WorkBibliographicView;
  readonly existingWork: WorkBibliographicView;
}

@Injectable()
export class MergeReviewService {
  constructor(
    @Inject(IDENTITY_SPINE_STORE) private readonly spine: IdentitySpineStore,
  ) {}

  async getReview(mergeCandidateId: string): Promise<MergeReviewView> {
    const view = await this.spine.getMergeReviewView(mergeCandidateId);
    if (view === null) {
      throw new DomainError(ErrorCode.NotFound, { module: MODULE });
    }
    return {
      mergeCandidateId: view.candidate.id,
      matchType: view.candidate.matchType,
      status: view.candidate.status,
      evidence: sanitizeEvidence(view.candidate.evidence),
      candidateWork: view.candidateWork,
      existingWork: view.existingWork,
    };
  }
}

/** Strip any accidental project-scoped keys from stored evidence JSON. */
export function sanitizeEvidence(
  evidence: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const blocked = new Set([
    'projectId',
    'documentId',
    'documentIds',
    'evidenceId',
    'evidenceIds',
    'noteId',
    'membershipId',
    'userId',
    'orgId',
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (blocked.has(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Runtime shape guard used by tests — E-3 conformance. */
export function mergeReviewExposesProjectData(view: MergeReviewView): boolean {
  const blob = JSON.stringify(view);
  return /projectId|documentId|membership|noteId|"evidenceIds"/i.test(blob);
}
