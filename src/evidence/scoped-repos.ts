import { Injectable } from '@nestjs/common';
import type { ProjectScope, ScopedListQuery } from '../l0/ports';
import { ScopedReader } from '../platform/persistence/scoped-reader';

const MODULE = 'evidence';

@Injectable()
export class ClaimsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('claim', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('claim', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('claim', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('claim', scope, query);
  }
}

export { EvidenceRepository } from './evidence.repository';
