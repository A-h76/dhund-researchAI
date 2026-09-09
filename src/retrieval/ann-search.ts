import { Inject, Injectable } from '@nestjs/common';
import {
  SCOPED_STORE,
  type ProjectScope,
  type ScopedStore,
} from '../l0/ports';

@Injectable()
export class AnnSearch {
  constructor(@Inject(SCOPED_STORE) private readonly store: ScopedStore) {}

  nearest(scope: ProjectScope, vector: string, limit: number) {
    return this.store.annNearest(scope, vector, limit);
  }
}
