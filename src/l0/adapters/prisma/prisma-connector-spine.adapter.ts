import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateId } from '../../../platform/ids';
import { L0OperationError } from '../../ports/errors';
import type {
  AdmittedDocumentResult,
  ConnectorSpineHit,
  ConnectorSpineStore,
  DiscoveryCandidateRecord,
} from '../../ports/connector-spine.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

const ARXIV_RIGHTS_POLICY_VERSION = 'arxiv-rights-v1';

@Injectable()
export class PrismaConnectorSpineAdapter implements ConnectorSpineStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async upsertDiscoveryCandidate(input: {
    readonly projectId: string;
    readonly queryId: string;
    readonly connectorId: string;
    readonly hit: ConnectorSpineHit;
  }): Promise<DiscoveryCandidateRecord> {
    await this.database.connect();
    const metadata = hitToMetadata(input.hit);
    try {
      const row = await this.client().discoveryCandidate.upsert({
        where: {
          projectId_queryId_connectorId_externalId: {
            projectId: input.projectId,
            queryId: input.queryId,
            connectorId: input.connectorId,
            externalId: input.hit.externalId,
          },
        },
        create: {
          id: generateId(),
          projectId: input.projectId,
          queryId: input.queryId,
          connectorId: input.connectorId,
          externalId: input.hit.externalId,
          metadata: metadata as Prisma.InputJsonValue,
          status: 'pending_admission',
        },
        update: {
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      return toCandidate(row);
    } catch (error) {
      throw new L0OperationError('discovery_candidate upsert failed', error);
    }
  }

  async getCandidate(id: string): Promise<DiscoveryCandidateRecord | null> {
    await this.database.connect();
    const row = await this.client().discoveryCandidate.findUnique({ where: { id } });
    return row === null ? null : toCandidate(row);
  }

  async setCandidateStatus(
    id: string,
    status: DiscoveryCandidateRecord['status'],
  ): Promise<DiscoveryCandidateRecord> {
    await this.database.connect();
    const row = await this.client().discoveryCandidate.update({
      where: { id },
      data: { status },
    });
    return toCandidate(row);
  }

  async ensureRightsSnapshot(input: {
    readonly connectorId: string;
    readonly policyVersion: string;
    readonly capabilities: { metadata: boolean; body: boolean };
  }): Promise<string> {
    await this.database.connect();
    const existing = await this.client().rightsSnapshot.findUnique({
      where: {
        connectorId_policyVersion: {
          connectorId: input.connectorId,
          policyVersion: input.policyVersion,
        },
      },
    });
    if (existing !== null) {
      return existing.id;
    }
    const created = await this.client().rightsSnapshot.create({
      data: {
        id: generateId(),
        connectorId: input.connectorId,
        policyVersion: input.policyVersion,
        capabilities: input.capabilities as Prisma.InputJsonValue,
        capturedAt: new Date(),
      },
    });
    return created.id;
  }

  async createAdmittedDocument(input: {
    readonly orgId: string;
    readonly projectId: string;
    readonly connectorId: string;
    readonly hit: ConnectorSpineHit;
    readonly storageKey: string;
    readonly bodyBytes: Buffer | null;
    readonly rightsSnapshotId: string;
  }): Promise<AdmittedDocumentResult> {
    await this.database.connect();
    const documentId = generateId();
    const bodyAdmitted = input.bodyBytes !== null && input.hit.rights.body;
    const documentVersionId = bodyAdmitted ? generateId() : null;
    const contentHash =
      input.bodyBytes !== null
        ? createHash('sha256').update(input.bodyBytes).digest('hex')
        : null;

    try {
      await this.client().$transaction(async (tx) => {
        await tx.document.create({
          data: {
            id: documentId,
            projectId: input.projectId,
            orgId: input.orgId,
            title: input.hit.title,
            authors: [...input.hit.authors],
            year: input.hit.year ?? null,
            doi: input.hit.doi ?? null,
            arxivId: input.connectorId === 'arxiv' ? input.hit.externalId : null,
            abstract: input.hit.abstract ?? null,
            storageKey: input.storageKey,
            status: bodyAdmitted ? 'queued' : 'completed',
            rightsSnapshotId: input.rightsSnapshotId,
          },
        });
        if (documentVersionId !== null) {
          await tx.documentVersion.create({
            data: {
              id: documentVersionId,
              documentId,
              versionNo: 1,
              storageKey: input.storageKey,
            },
          });
        }
      });
    } catch (error) {
      throw new L0OperationError('admitted document create failed', error);
    }

    return {
      documentId,
      documentVersionId,
      contentHash,
      storageKey: input.storageKey,
      rightsSnapshotId: input.rightsSnapshotId,
      bodyAdmitted,
    };
  }

  defaultPolicyVersion(connectorId: string): string {
    if (connectorId === 'arxiv') {
      return ARXIV_RIGHTS_POLICY_VERSION;
    }
    return `${connectorId}-rights-v1`;
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

function hitToMetadata(hit: ConnectorSpineHit): Record<string, unknown> {
  return {
    title: hit.title,
    authors: hit.authors,
    abstract: hit.abstract ?? null,
    year: hit.year ?? null,
    doi: hit.doi ?? null,
    licenseUrl: hit.licenseUrl ?? null,
    pdfUrl: hit.pdfUrl ?? null,
    landingUrl: hit.landingUrl ?? null,
    rights: hit.rights,
    raw: hit.rawMetadata,
  };
}

function toCandidate(row: {
  id: string;
  projectId: string;
  queryId: string;
  connectorId: string;
  externalId: string;
  metadata: unknown;
  status: DiscoveryCandidateRecord['status'];
  resolvedCanonicalWorkId: string | null;
}): DiscoveryCandidateRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    queryId: row.queryId,
    connectorId: row.connectorId,
    externalId: row.externalId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    status: row.status,
    resolvedCanonicalWorkId: row.resolvedCanonicalWorkId,
  };
}
