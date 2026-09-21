import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTOR_SPINE_STORE,
  type ConnectorSpineStore,
  OBJECT_STORAGE_SERVICE,
  type ObjectStorageService,
} from '../l0/ports';
import { requestExtractJob } from '../ingestion/request-extract';
import { DomainError, ErrorCode } from '../platform/errors';
import { JobEnqueueService } from '../platform/logging';
import { IdentityResolveService } from '../identity/identity-resolve.service';
import { ConnectorFetchService } from './connector-fetch.service';
import { ConnectorMetrics } from './connector.metrics';
import { RightsBodyForbiddenError } from './rights-body';
import type { ConnectorSearchHit } from './source-connector';

export interface DiscoveryAdmitInput {
  readonly orgId: string;
  readonly candidateId: string;
  readonly correlationId: string;
  /** When false, record rejected and do not delete. */
  readonly admit: boolean;
}

export interface DiscoveryAdmitResult {
  readonly candidateId: string;
  readonly status: string;
  readonly documentId?: string;
  readonly documentVersionId?: string;
  readonly extractJobId?: string;
  readonly canonicalWorkId?: string;
}

/**
 * Admits or rejects a discovery candidate.
 * Admission creates a Document and, when body rights permit, enqueues the
 * canonical extract chain via requestExtractJob (R9) — never a second path.
 */
@Injectable()
export class DiscoveryAdmissionService {
  constructor(
    @Inject(CONNECTOR_SPINE_STORE) private readonly spine: ConnectorSpineStore,
    private readonly fetch: ConnectorFetchService,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    private readonly enqueue: JobEnqueueService,
    private readonly metrics: ConnectorMetrics,
    private readonly identity: IdentityResolveService,
  ) {}

  async decide(input: DiscoveryAdmitInput): Promise<DiscoveryAdmitResult> {
    const candidate = await this.spine.getCandidate(input.candidateId);
    if (candidate === null) {
      throw new DomainError(ErrorCode.NotFound, { module: 'connectors' });
    }

    if (!input.admit) {
      const rejected = await this.spine.setCandidateStatus(candidate.id, 'rejected');
      this.metrics.recordCandidateState('rejected');
      return { candidateId: rejected.id, status: rejected.status };
    }

    let fetched;
    try {
      fetched = await this.fetch.execute({
        orgId: input.orgId,
        connectorId: candidate.connectorId,
        externalId: candidate.externalId,
        purpose: 'admit',
        freshnessTtl: 86_400,
        correlationId: input.correlationId,
        includeBody: true,
      });
    } catch (error) {
      // PX-b: rights-forbidden body fetch is rejected; admit metadata-only instead.
      if (!(error instanceof RightsBodyForbiddenError)) {
        throw error;
      }
      fetched = await this.fetch.execute({
        orgId: input.orgId,
        connectorId: candidate.connectorId,
        externalId: candidate.externalId,
        purpose: 'admit-metadata',
        freshnessTtl: 86_400,
        correlationId: input.correlationId,
        includeBody: false,
      });
    }

    const hit = fetched.metadata;
    assertMetadataIsDataOnly(hit);

    const rightsSnapshotId = await this.spine.ensureRightsSnapshot({
      connectorId: candidate.connectorId,
      policyVersion: this.spine.defaultPolicyVersion(candidate.connectorId),
      capabilities: hit.rights,
    });

    const storageId = candidate.id;
    const filename = `${candidate.externalId.replace(/[/\\]/g, '_')}.pdf`;
    const storageKey = this.storage.generateObjectKey(
      input.orgId,
      candidate.projectId,
      'connectors',
      storageId,
      hit.rights.body && fetched.body !== undefined ? filename : 'metadata.json',
    );

    let bodyBytes: Buffer | null = null;
    if (hit.rights.body && fetched.body !== undefined) {
      bodyBytes = fetched.body;
      await this.storage.putObject(storageKey, bodyBytes, 'application/pdf');
    } else {
      const metaPayload = Buffer.from(
        JSON.stringify({
          connectorId: candidate.connectorId,
          externalId: candidate.externalId,
          title: hit.title,
          authors: hit.authors,
          abstract: hit.abstract ?? null,
        }),
        'utf8',
      );
      await this.storage.putObject(storageKey, metaPayload, 'application/json');
    }

    const document = await this.spine.createAdmittedDocument({
      orgId: input.orgId,
      projectId: candidate.projectId,
      connectorId: candidate.connectorId,
      hit,
      storageKey,
      bodyBytes,
      rightsSnapshotId,
    });

    const admitted = await this.spine.setCandidateStatus(candidate.id, 'admitted');
    this.metrics.recordCandidateState('admitted');

    let canonicalWorkId: string | undefined;
    const resolveIdentifier = resolveIdentifierFromHit(candidate.connectorId, hit);
    if (resolveIdentifier !== null) {
      const resolved = await this.identity.execute({
        orgId: input.orgId,
        correlationId: input.correlationId,
        identifier: resolveIdentifier,
        title: hit.title,
        authors: hit.authors,
        year: hit.year,
        documentId: document.documentId,
      });
      canonicalWorkId = resolved.canonicalWorkId;
    }

    let extractJobId: string | undefined;
    if (
      document.bodyAdmitted &&
      document.documentVersionId !== null &&
      document.contentHash !== null
    ) {
      extractJobId = await requestExtractJob(this.enqueue, {
        orgId: input.orgId,
        projectId: candidate.projectId,
        documentVersionId: document.documentVersionId,
        contentHash: document.contentHash,
      });
    }

    return {
      candidateId: admitted.id,
      status: admitted.status,
      documentId: document.documentId,
      ...(document.documentVersionId !== null
        ? { documentVersionId: document.documentVersionId }
        : {}),
      ...(extractJobId !== undefined ? { extractJobId } : {}),
      ...(canonicalWorkId !== undefined ? { canonicalWorkId } : {}),
    };
  }
}

function resolveIdentifierFromHit(
  connectorId: string,
  hit: ConnectorSearchHit,
): { scheme: 'doi' | 'arxiv'; value: string } | null {
  if (typeof hit.doi === 'string' && hit.doi.length > 0) {
    return { scheme: 'doi', value: hit.doi };
  }
  if (connectorId === 'arxiv' && hit.externalId.length > 0) {
    return { scheme: 'arxiv', value: hit.externalId };
  }
  return null;
}

/**
 * External titles/abstracts are untrusted data. Callers must never pass them as
 * system instructions — this helper documents + asserts the boundary for tests.
 */
export function assertMetadataIsDataOnly(hit: ConnectorSearchHit): void {
  if (typeof hit.title !== 'string') {
    throw new DomainError(ErrorCode.ValidationError, { module: 'connectors' });
  }
}

export function asUntrustedExternalText(value: string): string {
  return value;
}
