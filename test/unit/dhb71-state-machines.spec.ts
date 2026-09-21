import {
  canTransitionMergeCandidate,
  MERGE_CANDIDATE_TRANSITIONS,
} from '../../src/identity/merge-candidate-state';
import {
  canTransitionExternalRecord,
  EXTERNAL_RECORD_TRANSITIONS,
  lifecycleOf,
} from '../../src/identity/external-record-state';
import {
  canTransitionImportSession,
  IMPORT_SESSION_TRANSITIONS,
} from '../../src/identity/import-session-state';

describe('DHB-71 state machines — MergeCandidate / ExternalRecord / ImportSession', () => {
  it('MergeCandidate: pending → merged|rejected; terminals have no outbound edges', () => {
    expect(canTransitionMergeCandidate('pending', 'merged')).toBe(true);
    expect(canTransitionMergeCandidate('pending', 'rejected')).toBe(true);
    expect(canTransitionMergeCandidate('merged', 'pending')).toBe(false);
    expect(canTransitionMergeCandidate('rejected', 'merged')).toBe(false);
    expect(MERGE_CANDIDATE_TRANSITIONS.merged).toEqual([]);
    expect(MERGE_CANDIDATE_TRANSITIONS.rejected).toEqual([]);
  });

  it('ExternalRecord: active↔stale, either → deleted; deleted terminal', () => {
    expect(canTransitionExternalRecord('active', 'stale')).toBe(true);
    expect(canTransitionExternalRecord('stale', 'active')).toBe(true);
    expect(canTransitionExternalRecord('active', 'deleted')).toBe(true);
    expect(canTransitionExternalRecord('deleted', 'active')).toBe(false);
    expect(EXTERNAL_RECORD_TRANSITIONS.deleted).toEqual([]);
    expect(lifecycleOf({ deletedAt: null, staleAt: null })).toBe('active');
    expect(lifecycleOf({ deletedAt: null, staleAt: new Date() })).toBe('stale');
    expect(lifecycleOf({ deletedAt: new Date(), staleAt: null })).toBe('deleted');
  });

  it('ImportSession: CREATED→PARSING→ADMITTING→terminal', () => {
    expect(canTransitionImportSession('CREATED', 'PARSING')).toBe(true);
    expect(canTransitionImportSession('PARSING', 'ADMITTING')).toBe(true);
    expect(canTransitionImportSession('ADMITTING', 'COMPLETED')).toBe(true);
    expect(canTransitionImportSession('COMPLETED', 'PARSING')).toBe(false);
    expect(IMPORT_SESSION_TRANSITIONS.FAILED).toEqual([]);
  });
});
