import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTOR_SPINE_STORE,
  type ConnectorSpineStore,
  EXTERNAL_RECORD_SPINE_STORE,
  type ExternalRecordSpineStore,
  OBJECT_STORAGE_SERVICE,
  type ObjectStorageService,
} from '../l0/ports';
import { requestExtractJob } from '../ingestion/request-extract';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids';
import { JobEnqueueService } from '../platform/logging';
import {
  canTransitionImportSession,
  type ImportSessionLifecycle,
} from '../identity/import-session-state';
import { IdentityResolveService } from '../identity/identity-resolve.service';
import { bindEvidenceToSnapshot } from './snapshot-binding';

const MODULE = 'external_records';
const ZOTERO_CONNECTOR = 'zotero';

export interface RefmgrImportItem {
  readonly externalId: string;
  readonly title: string;
  readonly authors?: readonly string[];
  readonly year?: number;
  readonly doi?: string;
  readonly pmid?: string;
  readonly arxivId?: string;
  readonly abstract?: string;
  /** Optional PDF bytes (base64) when the session already holds content. */
  readonly bodyBase64?: string;
}

export interface RefmgrImportJobPayload {
  readonly orgId: string;
  readonly projectId: string;
  readonly correlationId: string;
  readonly importSessionId: string;
  readonly items: readonly RefmgrImportItem[];
}

export interface RefmgrImportResult {
  readonly importSessionId: string;
  readonly state: ImportSessionLifecycle;
  readonly itemsAdmitted: number;
  readonly itemsRejected: number;
  readonly extractJobIds: readonly string[];
}

/**
 * Zotero / refmgr import admits into the existing extract chain (R9) — never a
 * second ingestion path.
 */
@Injectable()
export class RefmgrImportService {
  constructor(
    @Inject(EXTERNAL_RECORD_SPINE_STORE)
    private readonly records: ExternalRecordSpineStore,
    @Inject(CONNECTOR_SPINE_STORE) private readonly spine: ConnectorSpineStore,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    private readonly enqueue: JobEnqueueService,
    private readonly identity: IdentityResolveService,
  ) {}

  async execute(payload: RefmgrImportJobPayload): Promise<RefmgrImportResult> {
    const session = await this.records.getImportSession(payload.importSessionId);
    if (session === null || session.projectId !== payload.projectId) {
      throw new DomainError(ErrorCode.NotFound, { module: MODULE });
    }

    await this.transition(session.id, session.state as ImportSessionLifecycle, 'PARSING');
    await this.transition(session.id, 'PARSING', 'ADMITTING');

    const rightsSnapshotId = await this.spine.ensureRightsSnapshot({
      connectorId: ZOTERO_CONNECTOR,
      policyVersion: this.spine.defaultPolicyVersion(ZOTERO_CONNECTOR),
      capabilities: { metadata: true, body: true },
    });

    let admitted = 0;
    let rejected = 0;
    const extractJobIds: string[] = [];
    const errors: unknown[] = [];

    for (const item of payload.items) {
      try {
        const recordId = generateId();
        await this.records.createRecord({
          id: recordId,
          projectId: payload.projectId,
          connectorId: ZOTERO_CONNECTOR,
          externalId: item.externalId,
          type: 'zotero_item',
          rightsSnapshotId,
        });

        const snapshotId = generateId();
        const capturedAt = new Date();
        let contentRef: string | null = null;
        let bodyBytes: Buffer | null = null;
        if (item.bodyBase64 !== undefined && item.bodyBase64.length > 0) {
          bodyBytes = Buffer.from(item.bodyBase64, 'base64');
          contentRef = this.storage.generateObjectKey(
            payload.orgId,
            payload.projectId,
            'refmgr',
            recordId,
            `${item.externalId.replace(/[/\\]/g, '_')}.pdf`,
          );
          await this.storage.putObject(contentRef, bodyBytes, 'application/pdf');
        }

        const metadata = {
          title: item.title,
          authors: item.authors ?? [],
          year: item.year ?? null,
          doi: item.doi ?? null,
          pmid: item.pmid ?? null,
          arxivId: item.arxivId ?? null,
          abstract: item.abstract ?? null,
          // Evidence extracted from this snapshot stays bound to it after refresh.
          evidenceLocatorHint: bindEvidenceToSnapshot({}, snapshotId),
        };

        await this.records.appendSnapshot({
          id: snapshotId,
          externalRecordId: recordId,
          capturedAt,
          contentRef,
          metadata,
        });

        const hit = {
          externalId: item.externalId,
          title: item.title,
          authors: item.authors ?? [],
          abstract: item.abstract,
          year: item.year,
          doi: item.doi,
          rawMetadata: { source: 'zotero', externalId: item.externalId },
          rights: { metadata: true, body: bodyBytes !== null },
        };

        const storageKey =
          contentRef ??
          this.storage.generateObjectKey(
            payload.orgId,
            payload.projectId,
            'refmgr',
            recordId,
            'metadata.json',
          );
        if (contentRef === null) {
          await this.storage.putObject(
            storageKey,
            Buffer.from(JSON.stringify(metadata), 'utf8'),
            'application/json',
          );
        }

        const document = await this.spine.createAdmittedDocument({
          orgId: payload.orgId,
          projectId: payload.projectId,
          connectorId: ZOTERO_CONNECTOR,
          hit,
          storageKey,
          bodyBytes,
          rightsSnapshotId,
        });

        const scheme = item.doi
          ? 'doi'
          : item.pmid
            ? 'pmid'
            : item.arxivId
              ? 'arxiv'
              : null;
        const value = item.doi ?? item.pmid ?? item.arxivId ?? null;
        if (scheme !== null && value !== null) {
          await this.identity.execute({
            orgId: payload.orgId,
            correlationId: payload.correlationId,
            identifier: { scheme, value },
            title: item.title,
            authors: item.authors,
            year: item.year,
            documentId: document.documentId,
            externalRecordId: recordId,
          });
        }

        if (
          document.bodyAdmitted &&
          document.documentVersionId !== null &&
          document.contentHash !== null
        ) {
          // R9: sole entry onto extract chain.
          const jobId = await requestExtractJob(this.enqueue, {
            orgId: payload.orgId,
            projectId: payload.projectId,
            documentVersionId: document.documentVersionId,
            contentHash: document.contentHash,
          });
          extractJobIds.push(jobId);
        }

        admitted += 1;
      } catch (error) {
        rejected += 1;
        errors.push({
          externalId: item.externalId,
          message: error instanceof Error ? error.message : 'admit failed',
        });
      }
    }

    const terminal: ImportSessionLifecycle =
      rejected === 0 ? 'COMPLETED' : admitted === 0 ? 'FAILED' : 'PARTIAL';
    await this.records.updateImportSession({
      id: session.id,
      state: terminal,
      itemsTotal: payload.items.length,
      itemsAdmitted: admitted,
      itemsRejected: rejected,
      errors,
      terminalAt: new Date(),
    });

    return {
      importSessionId: session.id,
      state: terminal,
      itemsAdmitted: admitted,
      itemsRejected: rejected,
      extractJobIds,
    };
  }

  private async transition(
    id: string,
    from: ImportSessionLifecycle,
    to: ImportSessionLifecycle,
  ): Promise<void> {
    if (!canTransitionImportSession(from, to)) {
      throw new DomainError(ErrorCode.InvalidStateTransition, { module: MODULE });
    }
    await this.records.updateImportSession({ id, state: to });
  }
}

/** Content hash helper for tests / metadata-only admit. */
export function hashMetadataPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
