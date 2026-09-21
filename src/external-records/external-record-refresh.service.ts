import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTOR_SPINE_STORE,
  type ConnectorSpineStore,
  EXTERNAL_RECORD_SPINE_STORE,
  type ExternalRecordSpineStore,
  OBJECT_STORAGE_SERVICE,
  type ObjectStorageService,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids';
import { ConnectorFetchService } from '../connectors/connector-fetch.service';
import {
  canTransitionExternalRecord,
  ExternalRecordTransitionError,
  lifecycleOf,
} from '../identity/external-record-state';
import {
  ExternalRecordMetrics,
  snapshotPayloadHash,
} from './external-record.metrics';
import { assertBodyFetchPermitted, RightsBodyForbiddenError } from '../connectors/rights-body';

const MODULE = 'external_records';

export interface ExternalRecordRefreshJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly correlationId: string;
  readonly externalRecordId: string;
  readonly refreshInstant: string;
  readonly includeBody?: boolean;
}

export type RefreshOutcome =
  | 'snapshot_appended'
  | 'noop_checked'
  | 'failed_stale'
  | 'rights_rejected';

export interface ExternalRecordRefreshResult {
  readonly outcome: RefreshOutcome;
  readonly externalRecordId: string;
  readonly servingSnapshotId: string | null;
  readonly newSnapshotId?: string;
  readonly evidenceCapability: 'body' | 'metadata_only';
}

@Injectable()
export class ExternalRecordRefreshService {
  constructor(
    @Inject(EXTERNAL_RECORD_SPINE_STORE)
    private readonly records: ExternalRecordSpineStore,
    @Inject(CONNECTOR_SPINE_STORE) private readonly spine: ConnectorSpineStore,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    private readonly fetch: ConnectorFetchService,
    private readonly metrics: ExternalRecordMetrics,
  ) {}

  async execute(
    payload: ExternalRecordRefreshJobPayload,
  ): Promise<ExternalRecordRefreshResult> {
    const record = await this.records.getRecord(payload.externalRecordId);
    if (record === null || record.deletedAt !== null) {
      throw new DomainError(ErrorCode.NotFound, { module: MODULE });
    }
    if (record.projectId !== payload.projectId) {
      throw new DomainError(ErrorCode.NotFound, { module: MODULE });
    }

    const prior = await this.records.getLatestSnapshot(record.id);
    const includeBody = payload.includeBody === true;

    try {
      const fetched = await this.fetch.execute({
        orgId: payload.orgId,
        connectorId: record.connectorId,
        externalId: record.externalId,
        purpose: 'external-record-refresh',
        freshnessTtl: 0,
        correlationId: payload.correlationId,
        includeBody,
      });

      assertBodyFetchPermitted({
        includeBody,
        rightsBody: fetched.metadata.rights.body,
      });

      const rightsSnapshotId = await this.spine.ensureRightsSnapshot({
        connectorId: record.connectorId,
        policyVersion: this.spine.defaultPolicyVersion(record.connectorId),
        capabilities: fetched.metadata.rights,
      });

      let contentRef: string | null = null;
      if (fetched.metadata.rights.body && fetched.body !== undefined) {
        contentRef = this.storage.generateObjectKey(
          payload.orgId,
          payload.projectId,
          'external-records',
          record.id,
          `${generateId()}.bin`,
        );
        await this.storage.putObject(
          contentRef,
          fetched.body,
          fetched.bodyContentType ?? 'application/octet-stream',
        );
      }

      const metadata: Record<string, unknown> = {
        title: fetched.metadata.title,
        authors: fetched.metadata.authors,
        abstract: fetched.metadata.abstract ?? null,
        year: fetched.metadata.year ?? null,
        doi: fetched.metadata.doi ?? null,
        rights: fetched.metadata.rights,
        rightsSnapshotId,
        raw: fetched.metadata.rawMetadata,
        payloadHash: snapshotPayloadHash(
          {
            title: fetched.metadata.title,
            authors: fetched.metadata.authors,
            abstract: fetched.metadata.abstract ?? null,
            year: fetched.metadata.year ?? null,
            doi: fetched.metadata.doi ?? null,
          },
          contentRef,
        ),
      };

      const newHash = String(metadata.payloadHash);
      const priorHash =
        prior !== null && typeof prior.metadata.payloadHash === 'string'
          ? prior.metadata.payloadHash
          : null;

      const checkedAt = new Date(payload.refreshInstant);
      if (priorHash !== null && priorHash === newHash) {
        const from = lifecycleOf(record);
        if (!canTransitionExternalRecord(from, 'active') && from !== 'active') {
          throw new ExternalRecordTransitionError(from, 'active');
        }
        await this.records.markChecked(record.id, checkedAt);
        this.metrics.recordSnapshotNoop();
        return {
          outcome: 'noop_checked',
          externalRecordId: record.id,
          servingSnapshotId: prior?.id ?? null,
          evidenceCapability: fetched.metadata.rights.body ? 'body' : 'metadata_only',
        };
      }

      const snapshotId = generateId();
      const created = await this.records.appendSnapshot({
        id: snapshotId,
        externalRecordId: record.id,
        capturedAt: checkedAt,
        contentRef,
        metadata,
      });
      this.metrics.recordSnapshotRefresh();
      return {
        outcome: 'snapshot_appended',
        externalRecordId: record.id,
        servingSnapshotId: created.id,
        newSnapshotId: created.id,
        evidenceCapability: fetched.metadata.rights.body ? 'body' : 'metadata_only',
      };
    } catch (error) {
      if (error instanceof RightsBodyForbiddenError) {
        this.metrics.recordRightsRejection();
        const serving = prior?.id ?? null;
        return {
          outcome: 'rights_rejected',
          externalRecordId: record.id,
          servingSnapshotId: serving,
          evidenceCapability: 'metadata_only',
        };
      }

      const from = lifecycleOf(record);
      if (!canTransitionExternalRecord(from, 'stale') && from !== 'stale') {
        throw error;
      }
      await this.records.markStale(record.id, new Date());
      this.metrics.recordRefreshFailure();
      this.metrics.recordStale();
      return {
        outcome: 'failed_stale',
        externalRecordId: record.id,
        servingSnapshotId: prior?.id ?? null,
        evidenceCapability: 'metadata_only',
      };
    }
  }
}
