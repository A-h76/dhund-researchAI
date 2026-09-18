import type {
  AnnHit,
  ProjectScope,
  ScopedListQuery,
  ScopedRow,
  ScopedStore,
  TenantEntity,
} from '../../src/l0/ports/scoped-store.port';

const SOFT_DELETE = new Set<TenantEntity>([
  'document',
  'claim',
  'conversation',
  'external_record',
]);

export class MemoryScopedStore implements ScopedStore {
  readonly rows = new Map<TenantEntity, ScopedRow[]>();

  insert(
    entity: TenantEntity,
    scope: ProjectScope,
    row: Record<string, unknown>,
  ): Promise<ScopedRow> {
    const id = String(row.id);
    if (entity === 'message') {
      const conversationId = String(row.conversationId);
      const sequence = Number(row.sequence);
      const conflict = this.bucket(entity).some(
        (existing) =>
          existing.conversationId === conversationId &&
          Number(existing.sequence) === sequence,
      );
      if (conflict) {
        const error = new Error('unique constraint failed') as Error & { code: string };
        error.code = 'P2002';
        return Promise.reject(error);
      }
    }
    const stored: ScopedRow = {
      ...row,
      id,
      projectId: scope.projectId,
    };
    const bucket = this.bucket(entity);
    bucket.push(stored);
    return Promise.resolve(stored);
  }

  get(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
  ): Promise<ScopedRow | null> {
    return Promise.resolve(this.findLive(entity, scope, id));
  }

  async update(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ScopedRow | null> {
    const existing = this.findLive(entity, scope, id);
    if (existing === null) {
      return null;
    }
    const data = { ...patch };
    delete data.id;
    delete data.projectId;
    const next: ScopedRow = {
      ...existing,
      ...data,
      id,
      projectId: scope.projectId,
    };
    const bucket = this.bucket(entity);
    const index = bucket.findIndex((row) => row.id === id);
    bucket[index] = next;
    return next;
  }

  async delete(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
  ): Promise<boolean> {
    const existing = this.findLive(entity, scope, id);
    if (existing === null) {
      return false;
    }
    if (SOFT_DELETE.has(entity)) {
      await this.update(entity, scope, id, { deletedAt: new Date().toISOString() });
      return true;
    }
    const bucket = this.bucket(entity);
    const index = bucket.findIndex((row) => row.id === id);
    bucket.splice(index, 1);
    return true;
  }

  list(
    entity: TenantEntity,
    scope: ProjectScope,
    query: ScopedListQuery,
  ): Promise<readonly ScopedRow[]> {
    const live = this.bucket(entity)
      .filter((row) => row.projectId === scope.projectId && !this.isDeleted(entity, row))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (query.afterId !== undefined) {
      const cursor = live.find((row) => row.id === query.afterId);
      if (cursor === undefined) {
        return Promise.resolve([]);
      }
      const after = live.filter((row) => row.id > query.afterId!);
      return Promise.resolve(after.slice(0, query.limit));
    }
    return Promise.resolve(live.slice(0, query.limit));
  }

  lastEfSearch: number | undefined;
  lastLimit: number | undefined;
  annHits: AnnHit[] = [];
  annUnavailable = false;

  annNearest(
    _scope: ProjectScope,
    _vector: string,
    limit: number,
    options?: { readonly efSearch?: number },
  ): Promise<readonly AnnHit[]> {
    this.lastEfSearch = options?.efSearch;
    this.lastLimit = limit;
    if (this.annUnavailable) {
      return Promise.reject(new Error('vector down'));
    }
    return Promise.resolve(this.annHits);
  }

  private bucket(entity: TenantEntity): ScopedRow[] {
    const existing = this.rows.get(entity);
    if (existing !== undefined) {
      return existing;
    }
    const created: ScopedRow[] = [];
    this.rows.set(entity, created);
    return created;
  }

  private findLive(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
  ): ScopedRow | null {
    const found = this.bucket(entity).find(
      (row) =>
        row.id === id &&
        row.projectId === scope.projectId &&
        !this.isDeleted(entity, row),
    );
    return found === undefined ? null : found;
  }

  private isDeleted(entity: TenantEntity, row: ScopedRow): boolean {
    return SOFT_DELETE.has(entity) && row.deletedAt != null;
  }
}
