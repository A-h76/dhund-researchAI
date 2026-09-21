import { DiscoveryAdmissionService } from '../../src/connectors/discovery-admission.service';
import type { ConnectorFetchService } from '../../src/connectors/connector-fetch.service';
import type { ConnectorMetrics } from '../../src/connectors/connector.metrics';
import type { IdentityResolveService } from '../../src/identity/identity-resolve.service';
import type {
  ConnectorSpineStore,
  DiscoveryCandidateRecord,
} from '../../src/l0/ports/connector-spine.port';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';
import type { JobEnqueueService } from '../../src/platform/logging';

function stubIdentity(): IdentityResolveService {
  return {
    execute: async () => ({
      outcome: 'created',
      canonicalWorkId: 'work-1',
      mergeCandidateIds: [],
    }),
  } as unknown as IdentityResolveService;
}

describe('DHB-70 discovery admission', () => {
  it('records rejected candidates instead of deleting them', async () => {
    const candidate: DiscoveryCandidateRecord = {
      id: 'cand-1',
      projectId: 'proj-1',
      queryId: 'q-1',
      connectorId: 'arxiv',
      externalId: '2301.00001',
      metadata: { title: 'Paper' },
      status: 'pending_admission',
      resolvedCanonicalWorkId: null,
    };

    let deleted = false;
    const spine: ConnectorSpineStore = {
      async upsertDiscoveryCandidate() {
        throw new Error('unused');
      },
      async getCandidate() {
        return candidate;
      },
      async setCandidateStatus(id, status) {
        expect(id).toBe('cand-1');
        return { ...candidate, status };
      },
      async ensureRightsSnapshot() {
        return 'rights-1';
      },
      async createAdmittedDocument() {
        throw new Error('should not create on reject');
      },
      defaultPolicyVersion() {
        return 'arxiv-rights-v1';
      },
    };

    const metrics = {
      recordCandidateState: jest.fn(),
    } as unknown as ConnectorMetrics;

    const service = new DiscoveryAdmissionService(
      spine,
      {} as ConnectorFetchService,
      new MemoryObjectStorage(),
      {
        enqueue: async () => {
          deleted = true;
          return 'job';
        },
      } as unknown as JobEnqueueService,
      metrics,
      stubIdentity(),
    );

    const result = await service.decide({
      orgId: 'org-1',
      candidateId: 'cand-1',
      correlationId: 'corr',
      admit: false,
    });

    expect(result.status).toBe('rejected');
    expect(result.candidateId).toBe('cand-1');
    expect(deleted).toBe(false);
    expect(metrics.recordCandidateState).toHaveBeenCalledWith('rejected');
  });

  it('admits with body by calling requestExtractJob via JobEnqueueService.extract', async () => {
    const candidate: DiscoveryCandidateRecord = {
      id: 'cand-2',
      projectId: 'proj-1',
      queryId: 'q-1',
      connectorId: 'arxiv',
      externalId: '2301.00001',
      metadata: { title: 'Paper' },
      status: 'pending_admission',
      resolvedCanonicalWorkId: null,
    };

    const enqueued: string[] = [];
    const spine: ConnectorSpineStore = {
      async upsertDiscoveryCandidate() {
        throw new Error('unused');
      },
      async getCandidate() {
        return candidate;
      },
      async setCandidateStatus(_id, status) {
        return { ...candidate, status };
      },
      async ensureRightsSnapshot() {
        return 'rights-1';
      },
      async createAdmittedDocument() {
        return {
          documentId: 'doc-1',
          documentVersionId: 'dv-1',
          contentHash: 'abc',
          storageKey: 'key',
          rightsSnapshotId: 'rights-1',
          bodyAdmitted: true,
        };
      },
      defaultPolicyVersion() {
        return 'arxiv-rights-v1';
      },
    };

    const fetch = {
      async execute() {
        return {
          externalId: '2301.00001',
          metadata: {
            externalId: '2301.00001',
            title: 'Paper',
            authors: ['A'],
            rawMetadata: {},
            rights: { metadata: true, body: true },
            pdfUrl: 'https://arxiv.org/pdf/2301.00001.pdf',
          },
          body: Buffer.from('%PDF-1.4'),
          bodyContentType: 'application/pdf',
        };
      },
    } as unknown as ConnectorFetchService;

    const service = new DiscoveryAdmissionService(
      spine,
      fetch,
      new MemoryObjectStorage(),
      {
        enqueue: async (queue: string) => {
          enqueued.push(queue);
          return 'extract-job-1';
        },
      } as unknown as JobEnqueueService,
      { recordCandidateState: jest.fn() } as unknown as ConnectorMetrics,
      stubIdentity(),
    );

    const result = await service.decide({
      orgId: 'org-1',
      candidateId: 'cand-2',
      correlationId: 'corr',
      admit: true,
    });

    expect(result.status).toBe('admitted');
    expect(result.extractJobId).toBe('extract-job-1');
    expect(enqueued).toEqual(['extract']);
  });
});
