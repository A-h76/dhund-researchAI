export interface ConnectorClock {
  now(): number;
}

export class SystemConnectorClock implements ConnectorClock {
  now(): number {
    return Date.now();
  }
}

export const CONNECTOR_CLOCK = Symbol('CONNECTOR_CLOCK');
