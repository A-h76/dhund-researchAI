export interface ConnectorSpineHit {
  readonly externalId: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly abstract?: string;
  readonly year?: number;
  readonly doi?: string;
  readonly licenseUrl?: string;
  readonly pdfUrl?: string;
  readonly landingUrl?: string;
  readonly rawMetadata: Record<string, unknown>;
  readonly rights: { readonly metadata: boolean; readonly body: boolean };
}

export interface DiscoveryCandidateRecord {
  readonly id: string;
  readonly projectId: string;
  readonly queryId: string;
  readonly connectorId: string;
  readonly externalId: string;
  readonly metadata: Record<string, unknown>;
  readonly status: 'pending_admission' | 'admitted' | 'rejected' | 'expired';
  readonly resolvedCanonicalWorkId: string | null;
}

export interface AdmittedDocumentResult {
  readonly documentId: string;
  readonly documentVersionId: string | null;
  readonly contentHash: string | null;
  readonly storageKey: string | null;
  readonly rightsSnapshotId: string;
  readonly bodyAdmitted: boolean;
}

export interface ConnectorSpineStore {
  upsertDiscoveryCandidate(input: {
    readonly projectId: string;
    readonly queryId: string;
    readonly connectorId: string;
    readonly hit: ConnectorSpineHit;
  }): Promise<DiscoveryCandidateRecord>;

  getCandidate(id: string): Promise<DiscoveryCandidateRecord | null>;

  setCandidateStatus(
    id: string,
    status: DiscoveryCandidateRecord['status'],
  ): Promise<DiscoveryCandidateRecord>;

  ensureRightsSnapshot(input: {
    readonly connectorId: string;
    readonly policyVersion: string;
    readonly capabilities: { metadata: boolean; body: boolean };
  }): Promise<string>;

  createAdmittedDocument(input: {
    readonly orgId: string;
    readonly projectId: string;
    readonly connectorId: string;
    readonly hit: ConnectorSpineHit;
    readonly storageKey: string;
    readonly bodyBytes: Buffer | null;
    readonly rightsSnapshotId: string;
  }): Promise<AdmittedDocumentResult>;

  defaultPolicyVersion(connectorId: string): string;
}

export const CONNECTOR_SPINE_STORE = Symbol('CONNECTOR_SPINE_STORE');
