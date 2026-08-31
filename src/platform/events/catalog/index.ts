import type { CatalogEventDefinition, EventVersionSchema } from '../schema/types';
import {
  AI_EVENTS,
  BILLING_EVENTS,
  DISCOVERY_EVENTS,
  EXTERNAL_RECORDS_EVENTS,
  IAM_EVENTS,
  IDENTITY_EVENTS,
  INGESTION_EVENTS,
  ORCHESTRATION_EVENTS,
  PROJECTS_EVENTS,
  SCREENING_EVENTS,
  SOURCE_CONNECTORS_EVENTS,
} from './definitions';

/** Phase 5 §4 — full domain/integration event catalog. */
export const EVENT_CATALOG: readonly CatalogEventDefinition[] = Object.freeze([
  ...IAM_EVENTS,
  ...PROJECTS_EVENTS,
  ...BILLING_EVENTS,
  ...INGESTION_EVENTS,
  ...ORCHESTRATION_EVENTS,
  ...AI_EVENTS,
  ...SCREENING_EVENTS,
  ...IDENTITY_EVENTS,
  ...EXTERNAL_RECORDS_EVENTS,
  ...DISCOVERY_EVENTS,
  ...SOURCE_CONNECTORS_EVENTS,
]);

const BY_TYPE = new Map(EVENT_CATALOG.map((entry) => [entry.eventType, entry]));

export const EVENT_CATALOG_DOMAINS = [
  'iam',
  'projects',
  'billing',
  'ingestion',
  'orchestration',
  'ai',
  'screening',
  'identity',
  'external-records',
  'discovery',
  'source-connectors',
] as const;

export function getCatalogEvent(eventType: string): CatalogEventDefinition | undefined {
  return BY_TYPE.get(eventType);
}

export function requireCatalogEvent(eventType: string): CatalogEventDefinition {
  const entry = getCatalogEvent(eventType);
  if (entry === undefined) {
    throw new Error(`Unknown event type "${eventType}" — not in Phase 5 §4 catalog`);
  }
  return entry;
}

export function getVersionSchema(
  eventType: string,
  schemaVersion: number,
): EventVersionSchema | undefined {
  const entry = getCatalogEvent(eventType);
  return entry?.versions.find((v) => v.schemaVersion === schemaVersion);
}

export function maxKnownSchemaVersion(eventType: string): number | undefined {
  const entry = getCatalogEvent(eventType);
  if (entry === undefined) {
    return undefined;
  }
  return Math.max(...entry.versions.map((v) => v.schemaVersion));
}

export function listCatalogEventTypes(): readonly string[] {
  return EVENT_CATALOG.map((entry) => entry.eventType);
}
