import { Injectable } from '@nestjs/common';
import type { ProjectScope, ScopedListQuery } from '../l0/ports';
import { ScopedReader } from '../platform/persistence/scoped-reader';

const MODULE = 'ingestion';

@Injectable()
export class ExternalRecordsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('external_record', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('external_record', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('external_record', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('external_record', scope, query);
  }
}
