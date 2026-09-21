import { assertBodyFetchPermitted, RightsBodyForbiddenError } from '../../src/connectors/rights-body';
import {
  ExternalRecordRefreshService,
} from '../../src/external-records/external-record-refresh.service';
import { ExternalRecordMetrics, snapshotPayloadHash } from '../../src/external-records/external-record.metrics';
import {
  bindEvidenceToSnapshot,
  resolveEvidenceSnapshot,
} from '../../src/external-records/snapshot-binding';
import type { ConnectorFetchService } from '../../src/connectors/connector-fetch.service';
import type { ConnectorSpineStore } from '../../src/l0/ports/connector-spine.port';
import type { PlatformLogger } from '../../src/platform/logging';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { MemoryExternalRecordSpineStore } from '../fixtures/memory-external-record-spine';
import { MemoryObjectStorage } from '../fixtures/memory-object-storage';

function stubLogger(): PlatformLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as PlatformLogger;
}

describe('DHB-71 external-record refresh / PX-b / snapshot binding', () => {
  it('PX-b: rights-forbidden body fetch is rejected; evidence stays metadata_only', () => {
    expect(() =>
      assertBodyFetchPermitted({ includeBody: true, rightsBody: false }),
    ).toThrow(RightsBodyForbiddenError);
    assertBodyFetchPermitted({ includeBody: false, rightsBody: false });
    assertBodyFetchPermitted({ includeBody: true, rightsBody: true });
  });

  it('R10: unchanged payload advances last_checked_at without a new snapshot', async () => {
    const records = new MemoryExternalRecordSpineStore();
    const recordId = generateId();
    const projectId = generateId();
    await records.createRecord({
      id: recordId,
      projectId,
      connectorId: 'arxiv',
      externalId: '2301.00001',
      type: 'web_page',
      rightsSnapshotId: generateId(),
    });
    const meta = {
      title: 'Same',
      authors: ['A'],
      abstract: null,
      year: 2020,
      doi: null,
    };
    const hash = snapshotPayloadHash(meta, null);
    const snapId = generateId();
    await records.appendSnapshot({
      id: snapId,
      externalRecordId: recordId,
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
      contentRef: null,
      metadata: { ...meta, payloadHash: hash, rights: { metadata: true, body: false } },
    });

    const fetch = {
      async execute() {
        return {
          externalId: '2301.00001',
          metadata: {
            externalId: '2301.00001',
            title: 'Same',
            authors: ['A'],
            year: 2020,
            rawMetadata: {},
            rights: { metadata: true, body: false },
          },
        };
      },
    } as unknown as ConnectorFetchService;

    const spine = {
      async ensureRightsSnapshot() {
        return generateId();
      },
      defaultPolicyVersion() {
        return 'v1';
      },
    } as unknown as ConnectorSpineStore;

    const service = new ExternalRecordRefreshService(
      records,
      spine,
      new MemoryObjectStorage(),
      fetch,
      new ExternalRecordMetrics(stubLogger()),
    );

    const result = await service.execute({
      orgId: generateId(),
      projectId,
      correlationId: generateId(),
      externalRecordId: recordId,
      refreshInstant: '2026-01-02T00:00:00.000Z',
    });

    expect(result.outcome).toBe('noop_checked');
    expect(records.snapshots).toHaveLength(1);
    expect(records.records.get(recordId)?.lastCheckedAt?.toISOString()).toBe(
      '2026-01-02T00:00:00.000Z',
    );
    expect(records.records.get(recordId)?.staleAt).toBeNull();
  });

  it('failed refresh keeps serving prior snapshot and marks staleness', async () => {
    const records = new MemoryExternalRecordSpineStore();
    const recordId = generateId();
    const projectId = generateId();
    await records.createRecord({
      id: recordId,
      projectId,
      connectorId: 'arxiv',
      externalId: '2301.00002',
      type: 'web_page',
      rightsSnapshotId: generateId(),
    });
    const snapId = generateId();
    await records.appendSnapshot({
      id: snapId,
      externalRecordId: recordId,
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
      contentRef: null,
      metadata: { payloadHash: 'x' },
    });

    const fetch = {
      async execute() {
        throw new Error('upstream down');
      },
    } as unknown as ConnectorFetchService;

    const service = new ExternalRecordRefreshService(
      records,
      {
        ensureRightsSnapshot: async () => generateId(),
        defaultPolicyVersion: () => 'v1',
      } as unknown as ConnectorSpineStore,
      new MemoryObjectStorage(),
      fetch,
      new ExternalRecordMetrics(stubLogger()),
    );

    const result = await service.execute({
      orgId: generateId(),
      projectId,
      correlationId: generateId(),
      externalRecordId: recordId,
      refreshInstant: '2026-01-03T00:00:00.000Z',
    });

    expect(result.outcome).toBe('failed_stale');
    expect(result.servingSnapshotId).toBe(snapId);
    expect(records.snapshots).toHaveLength(1);
    expect(records.records.get(recordId)?.staleAt).not.toBeNull();
  });

  it('evidence bound to snapshot n still resolves after n+1 exists', async () => {
    const records = new MemoryExternalRecordSpineStore();
    const recordId = generateId();
    await records.createRecord({
      id: recordId,
      projectId: generateId(),
      connectorId: 'arxiv',
      externalId: 'x',
      type: 'web_page',
      rightsSnapshotId: generateId(),
    });
    const n = generateId();
    const n1 = generateId();
    await records.appendSnapshot({
      id: n,
      externalRecordId: recordId,
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
      contentRef: null,
      metadata: { version: 1 },
    });
    await records.appendSnapshot({
      id: n1,
      externalRecordId: recordId,
      capturedAt: new Date('2026-01-02T00:00:00.000Z'),
      contentRef: null,
      metadata: { version: 2 },
    });

    const locator = bindEvidenceToSnapshot({ quote: 'hello' }, n);
    const resolved = await resolveEvidenceSnapshot(locator, (id) => records.getSnapshot(id));
    expect(resolved?.id).toBe(n);
    expect(resolved?.metadata).toEqual({ version: 1 });
    const latest = await records.getLatestSnapshot(recordId);
    expect(latest?.id).toBe(n1);
  });

  it('PX-b refresh: rights-rejected body yields metadata_only capability', async () => {
    const records = new MemoryExternalRecordSpineStore();
    const recordId = generateId();
    const projectId = generateId();
    await records.createRecord({
      id: recordId,
      projectId,
      connectorId: 'arxiv',
      externalId: '2301.00003',
      type: 'web_page',
      rightsSnapshotId: generateId(),
    });

    const fetch = {
      async execute() {
        throw new RightsBodyForbiddenError();
      },
    } as unknown as ConnectorFetchService;

    const metrics = new ExternalRecordMetrics(stubLogger());
    const service = new ExternalRecordRefreshService(
      records,
      {
        ensureRightsSnapshot: async () => generateId(),
        defaultPolicyVersion: () => 'v1',
      } as unknown as ConnectorSpineStore,
      new MemoryObjectStorage(),
      fetch,
      metrics,
    );

    const result = await service.execute({
      orgId: generateId(),
      projectId,
      correlationId: generateId(),
      externalRecordId: recordId,
      refreshInstant: new Date().toISOString(),
      includeBody: true,
    });

    expect(result.outcome).toBe('rights_rejected');
    expect(result.evidenceCapability).toBe('metadata_only');
    expect(metrics.snapshot().rightsRejections).toBe(1);
  });
});
