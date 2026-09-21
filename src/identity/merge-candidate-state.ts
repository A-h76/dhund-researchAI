/**
 * MergeCandidate state machine (Phase 7 §13a / DHB-71).
 * pending → merged | rejected. Terminal states have no outbound edges.
 */
export type MergeCandidateStatus = 'pending' | 'merged' | 'rejected';

export const MERGE_CANDIDATE_TRANSITIONS: Readonly<
  Record<MergeCandidateStatus, readonly MergeCandidateStatus[]>
> = {
  pending: ['merged', 'rejected'],
  merged: [],
  rejected: [],
};

export function canTransitionMergeCandidate(
  from: MergeCandidateStatus,
  to: MergeCandidateStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return MERGE_CANDIDATE_TRANSITIONS[from].includes(to);
}

export class MergeCandidateTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Forbidden merge_candidate transition ${from} -> ${to}`);
    this.name = 'MergeCandidateTransitionError';
  }
}
