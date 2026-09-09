import { Inject, Injectable } from '@nestjs/common';
import {
  SCOPED_STORE,
  type ProjectScope,
  type ScopedListQuery,
  type ScopedRow,
  type ScopedStore,
  type TenantEntity,
} from '../../l0/ports';
import { notFound } from '../errors';
import { isUuid } from '../ids/uuid-v7';
import { ScopedMetrics } from './scoped.metrics';

@Injectable()
export class ScopedReader {
  constructor(
    @Inject(SCOPED_STORE) private readonly store: ScopedStore,
    private readonly metrics: ScopedMetrics,
  ) {}

  async require(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
    module: string,
  ): Promise<ScopedRow> {
    if (!isUuid(id)) {
      this.metrics.recordNotFound();
      throw notFound({ module });
    }
    const row = await this.store.get(entity, scope, id);
    if (row === null) {
      this.metrics.recordNotFound();
      throw notFound({ module });
    }
    return row;
  }

  async update(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
    patch: Record<string, unknown>,
    module: string,
  ): Promise<ScopedRow> {
    if (!isUuid(id)) {
      this.metrics.recordNotFound();
      throw notFound({ module });
    }
    const row = await this.store.update(entity, scope, id, patch);
    if (row === null) {
      this.metrics.recordNotFound();
      throw notFound({ module });
    }
    return row;
  }

  async remove(
    entity: TenantEntity,
    scope: ProjectScope,
    id: string,
    module: string,
  ): Promise<void> {
    if (!isUuid(id)) {
      this.metrics.recordNotFound();
      throw notFound({ module });
    }
    const deleted = await this.store.delete(entity, scope, id);
    if (!deleted) {
      this.metrics.recordNotFound();
      throw notFound({ module });
    }
  }

  list(
    entity: TenantEntity,
    scope: ProjectScope,
    query: ScopedListQuery,
  ): Promise<readonly ScopedRow[]> {
    return this.store.list(entity, scope, query);
  }
}
