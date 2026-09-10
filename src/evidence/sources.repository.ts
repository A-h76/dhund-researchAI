import { Inject, Injectable } from '@nestjs/common';
import {
  SCOPED_STORE,
  type ProjectScope,
  type ScopedListQuery,
  type ScopedRow,
  type ScopedStore,
} from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { generateId } from '../platform/ids/uuid-v7';
import { ScopedReader } from '../platform/persistence/scoped-reader';

const MODULE = 'evidence';

export type SourceTypeValue = 'document' | 'external_record';

export interface CreateSourceInput {
  readonly type: SourceTypeValue;
  readonly documentId?: string | null;
  readonly externalRecordId?: string | null;
}

@Injectable()
export class SourcesRepository {
  constructor(
    private readonly reader: ScopedReader,
    @Inject(SCOPED_STORE) private readonly store: ScopedStore,
  ) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('source', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('source', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('source', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('source', scope, query);
  }

  async create(scope: ProjectScope, input: CreateSourceInput): Promise<ScopedRow> {
    const documentId = input.documentId ?? null;
    const externalRecordId = input.externalRecordId ?? null;

    switch (input.type) {
      case 'document': {
        if (documentId === null || externalRecordId !== null) {
          throw invalid();
        }
        await this.reader.require('document', scope, documentId, MODULE);
        break;
      }
      case 'external_record': {
        if (externalRecordId === null || documentId !== null) {
          throw invalid();
        }
        await this.reader.require('external_record', scope, externalRecordId, MODULE);
        break;
      }
      default: {
        const exhaustive: never = input.type;
        throw new DomainError(ErrorCode.ValidationError, {
          module: MODULE,
          serverDetail: String(exhaustive),
        });
      }
    }

    try {
      return await this.store.insert('source', scope, {
        id: generateId(),
        type: input.type,
        ...(documentId === null ? {} : { documentId }),
        ...(externalRecordId === null ? {} : { externalRecordId }),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(ErrorCode.AlreadyExists, { module: MODULE });
      }
      throw error;
    }
  }
}

function invalid(): DomainError {
  return new DomainError(ErrorCode.ValidationError, { module: MODULE });
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (current === undefined || current === null) {
      return false;
    }
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (code === 'P2002' || code === '23505') {
        return true;
      }
    }
    const message = current instanceof Error ? current.message : String(current);
    if (/23505|unique constraint|duplicate key/i.test(message)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
