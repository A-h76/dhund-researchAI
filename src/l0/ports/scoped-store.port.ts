export const TENANT_ENTITIES = [
  'document',
  'evidence',
  'claim',
  'research_run',
  'extraction_cell',
  'conversation',
  'message',
  'research_artifact',
  'screening_decision',
  'external_record',
] as const;

export type TenantEntity = (typeof TENANT_ENTITIES)[number];

export interface ProjectScope {
  readonly projectId: string;
}

export interface ScopedRow {
  readonly id: string;
  readonly projectId: string;
  readonly [key: string]: unknown;
}

export interface ScopedListQuery {
  readonly limit: number;
  readonly afterId?: string;
}

export interface AnnHit {
  readonly chunkId: string;
  readonly projectId: string;
}

export interface ScopedStore {
  get(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
  ): Promise<ScopedRow | null>;
  update(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ScopedRow | null>;
  delete(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
  ): Promise<boolean>;
  list(
    entity: TenantEntity,
    scope: ProjectScope,
    query: ScopedListQuery,
  ): Promise<readonly ScopedRow[]>;
  insert(
    entity: TenantEntity,
    scope: ProjectScope,
    row: Record<string, unknown>,
  ): Promise<ScopedRow>;
  annNearest(
    scope: ProjectScope,
    vector: string,
    limit: number,
  ): Promise<readonly AnnHit[]>;
}
