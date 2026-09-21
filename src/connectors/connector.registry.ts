import { Injectable } from '@nestjs/common';
import { ArxivConnector } from './adapters/arxiv.connector';
import { CONNECTOR_IDS, type ConnectorId } from './connector.ids';
import type { SourceConnector } from './source-connector';

@Injectable()
export class SourceConnectorRegistry {
  private readonly connectors = new Map<string, SourceConnector>();

  constructor() {
    this.register(new ArxivConnector());
  }

  register(connector: SourceConnector): void {
    this.connectors.set(connector.id, connector);
  }

  get(id: string): SourceConnector {
    const connector = this.connectors.get(id);
    if (connector === undefined) {
      throw new Error(`Unknown connector: ${id}`);
    }
    return connector;
  }

  has(id: string): boolean {
    return this.connectors.has(id);
  }

  listIds(): readonly ConnectorId[] {
    return [...this.connectors.keys()] as ConnectorId[];
  }

  /** Replace a connector (tests / custom SSRF deps). */
  replace(connector: SourceConnector): void {
    this.connectors.set(connector.id, connector);
  }
}

export function isKnownConnectorId(id: string): id is ConnectorId {
  return (Object.values(CONNECTOR_IDS) as string[]).includes(id);
}
