/** Field-level schema for compatibility / contract tests (GAP-EVENT-VER-01). */
export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface FieldSchema {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
}

export interface EventVersionSchema {
  readonly schemaVersion: number;
  readonly fields: readonly FieldSchema[];
}

export interface CatalogEventDefinition {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly domain:
    | 'iam'
    | 'projects'
    | 'billing'
    | 'ingestion'
    | 'orchestration'
    | 'ai'
    | 'screening'
    | 'identity'
    | 'external-records'
    | 'discovery'
    | 'source-connectors';
  /** Current published version. */
  readonly currentVersion: number;
  /** All versions in the compatibility window (inclusive). */
  readonly versions: readonly EventVersionSchema[];
}

export function field(name: string, type: FieldType, required = true): FieldSchema {
  return { name, type, required };
}
