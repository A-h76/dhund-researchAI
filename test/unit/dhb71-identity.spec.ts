import { IdentityResolveService } from '../../src/identity/identity-resolve.service';
import { IdentityMergeService } from '../../src/identity/identity-merge.service';
import {
  MergeReviewService,
  mergeReviewExposesProjectData,
} from '../../src/identity/merge-review.service';
import { IdentityMetrics } from '../../src/identity/identity.metrics';
import type { PlatformLogger } from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { DomainError } from '../../src/platform/errors';
import { MemoryIdentityLookupStore } from '../fixtures/memory-identity-lookup';
import { MemoryIdentitySpineStore } from '../fixtures/memory-identity-spine';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

describe('DHB-71 identity resolve / merge — E-2 / E-3 / E-4', () => {
  it('E-2 (honesty): fuzzy match produces pending MergeCandidate(fuzzy_title) and never merges', async () => {
    const spine = new MemoryIdentitySpineStore();
    const trigram = new MemoryIdentityLookupStore();
    const metrics = new IdentityMetrics(stubLogger());

    const existingId = generateId();
    const candidateId = generateId();
    spine.works.set(existingId, {
      id: existingId,
      canonicalTitle: 'Metformin in Adults',
      authorHash: 'a',
      year: 2020,
      type: 'article',
    });
    spine.works.set(candidateId, {
      id: candidateId,
      canonicalTitle: 'Metformin in Adults',
      authorHash: 'b',
      year: 2020,
      type: 'article',
    });
    trigram.canonicalWorks = [
      { workId: existingId, title: 'Metformin in Adults' },
      { workId: candidateId, title: 'Metformin in Adults' },
    ];

    await spine.attachIdentifier({
      id: generateId(),
      canonicalWorkId: existingId,
      scheme: 'doi',
      value: '10.1000/existing',
    });

    const resolve = new IdentityResolveService(spine, trigram, metrics);
    const result = await resolve.execute({
      orgId: generateId(),
      correlationId: generateId(),
      identifier: { scheme: 'doi', value: '10.1000/new-paper' },
      title: 'Metformin in Adults',
      authors: ['Smith'],
      year: 2020,
    });

    expect(result.outcome).toBe('created');
    expect(result.mergeCandidateIds.length).toBeGreaterThan(0);
    // Trigram propose persists pending fuzzy_title rows (same table as spine in prod).
    for (const id of result.mergeCandidateIds) {
      const row = trigram.mergeCandidates.find((candidate) => candidate.id === id);
      expect(row).toBeDefined();
      spine.mergeCandidates.push({
        id: row!.id,
        candidateWorkId: row!.candidateWorkId,
        existingWorkId: row!.existingWorkId,
        matchType: row!.matchType,
        evidence: { title: 'Metformin in Adults' },
        status: row!.status,
        reviewedBy: null,
      });
    }
    expect(spine.mergeCandidates.every((row) => row.status === 'pending')).toBe(true);
    expect(spine.mergeCandidates.every((row) => row.matchType === 'fuzzy_title')).toBe(true);
    expect(metrics.snapshot().mergeCandidatesByType.fuzzy_only).toBeGreaterThan(0);

    const merge = new IdentityMergeService(spine, metrics);
    await expect(
      merge.execute({
        orgId: generateId(),
        correlationId: generateId(),
        mergeCandidateId: result.mergeCandidateIds[0]!,
        decision: 'approve',
        reviewedBy: generateId(),
      }),
    ).rejects.toBeInstanceOf(DomainError);

    const still = await spine.getMergeCandidate(result.mergeCandidateIds[0]!);
    expect(still?.status).toBe('pending');
  });

  it('DOI exact match links to the existing Canonical Work', async () => {
    const spine = new MemoryIdentitySpineStore();
    const trigram = new MemoryIdentityLookupStore();
    const metrics = new IdentityMetrics(stubLogger());
    const workId = generateId();
    spine.works.set(workId, {
      id: workId,
      canonicalTitle: 'Exact DOI Paper',
      authorHash: 'h',
      year: 2021,
      type: 'article',
    });
    await spine.attachIdentifier({
      id: generateId(),
      canonicalWorkId: workId,
      scheme: 'doi',
      value: '10.1234/exact',
    });

    const documentId = generateId();
    const resolve = new IdentityResolveService(spine, trigram, metrics);
    const result = await resolve.execute({
      orgId: generateId(),
      correlationId: generateId(),
      identifier: { scheme: 'doi', value: 'https://doi.org/10.1234/exact' },
      documentId,
    });

    expect(result.outcome).toBe('linked');
    expect(result.canonicalWorkId).toBe(workId);
    expect(spine.linkedDocuments.get(documentId)).toBe(workId);
  });

  it('E-4: identity resolve result never reveals another project copy', async () => {
    const spine = new MemoryIdentitySpineStore();
    const trigram = new MemoryIdentityLookupStore();
    const metrics = new IdentityMetrics(stubLogger());
    const workId = generateId();
    spine.works.set(workId, {
      id: workId,
      canonicalTitle: 'Shared',
      authorHash: 'h',
      year: null,
      type: 'article',
    });
    await spine.attachIdentifier({
      id: generateId(),
      canonicalWorkId: workId,
      scheme: 'pmid',
      value: '12345',
    });

    const resolve = new IdentityResolveService(spine, trigram, metrics);
    const result = await resolve.execute({
      orgId: generateId(),
      correlationId: generateId(),
      identifier: { scheme: 'pmid', value: '12345' },
    });

    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/projectId|documentId|membership|evidence/i);
    expect(result.canonicalWorkId).toBe(workId);
  });

  it('E-3: merge review exposes no other project data', async () => {
    const spine = new MemoryIdentitySpineStore();
    const workA = generateId();
    const workB = generateId();
    spine.works.set(workA, {
      id: workA,
      canonicalTitle: 'A',
      authorHash: 'a',
      year: 2019,
      type: 'article',
    });
    spine.works.set(workB, {
      id: workB,
      canonicalTitle: 'B',
      authorHash: 'b',
      year: 2019,
      type: 'article',
    });
    const candidateId = generateId();
    spine.mergeCandidates.push({
      id: candidateId,
      candidateWorkId: workA,
      existingWorkId: workB,
      matchType: 'exact_doi',
      evidence: {
        scheme: 'doi',
        value: '10.1/x',
        projectId: 'should-be-stripped',
        documentId: 'should-be-stripped',
      },
      status: 'pending',
      reviewedBy: null,
    });

    const review = new MergeReviewService(spine);
    const view = await review.getReview(candidateId);
    expect(mergeReviewExposesProjectData(view)).toBe(false);
    expect(view.evidence).not.toHaveProperty('projectId');
    expect(view.evidence).not.toHaveProperty('documentId');
    expect(view.candidateWork.id).toBe(workA);
    expect(view.existingWork.id).toBe(workB);
  });
});
