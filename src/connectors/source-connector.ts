import type { ConnectorId } from './connector.ids';

/** Rights capabilities attached to connector-sourced content (PX-b). */
export interface ConnectorRightsCapabilities {
  readonly metadata: boolean;
  /** Full-text / body fetch permitted when true. */
  readonly body: boolean;
}

export interface ConnectorSearchHit {
  readonly externalId: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly abstract?: string;
  readonly year?: number;
  readonly doi?: string;
  readonly licenseUrl?: string;
  readonly pdfUrl?: string;
  readonly landingUrl?: string;
  /** Opaque provider payload stored as untrusted data only. */
  readonly rawMetadata: Record<string, unknown>;
  readonly rights: ConnectorRightsCapabilities;
}

export interface ConnectorFetchResult {
  readonly externalId: string;
  readonly metadata: ConnectorSearchHit;
  /** PDF (or other body) bytes when rights permit and body was requested. */
  readonly body?: Buffer;
  readonly bodyContentType?: string;
}

export interface SourceConnectorSearchInput {
  readonly query: string;
  readonly limit?: number;
}

export interface SourceConnectorFetchInput {
  readonly externalId: string;
  /** When true and rights.body, fetch body bytes. */
  readonly includeBody: boolean;
}

/**
 * Outbound literature / registry connector.
 * All network I/O must go through SSRF-safe fetch.
 */
export interface SourceConnector {
  readonly id: ConnectorId;
  search(input: SourceConnectorSearchInput): Promise<readonly ConnectorSearchHit[]>;
  fetch(input: SourceConnectorFetchInput): Promise<ConnectorFetchResult>;
}
