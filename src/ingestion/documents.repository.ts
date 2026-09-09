import { Injectable } from '@nestjs/common';
import type {
  ProjectScope,
  ScopedListQuery,
  ScopedRow,
} from '../l0/ports';
import { pickDto } from '../platform/persistence/pick-dto';
import { ScopedReader } from '../platform/persistence/scoped-reader';

const MODULE = 'ingestion';

export const DOCUMENT_DTO_KEYS = [
  'id',
  'projectId',
  'title',
  'status',
  'createdAt',
] as const;

export type DocumentDto = {
  readonly id: string;
  readonly projectId: string;
  readonly title: unknown;
  readonly status: unknown;
  readonly createdAt: unknown;
};

@Injectable()
export class DocumentsRepository {
  constructor(private readonly reader: ScopedReader) {}

  async get(scope: ProjectScope, id: string): Promise<DocumentDto> {
    return toDocumentDto(await this.reader.require('document', scope, id, MODULE));
  }

  async update(
    scope: ProjectScope,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<DocumentDto> {
    return toDocumentDto(
      await this.reader.update('document', scope, id, patch, MODULE),
    );
  }

  remove(scope: ProjectScope, id: string): Promise<void> {
    return this.reader.remove('document', scope, id, MODULE);
  }

  async list(
    scope: ProjectScope,
    query: ScopedListQuery,
  ): Promise<readonly DocumentDto[]> {
    const rows = await this.reader.list('document', scope, query);
    return rows.map(toDocumentDto);
  }
}

function toDocumentDto(row: ScopedRow): DocumentDto {
  return pickDto(row, DOCUMENT_DTO_KEYS);
}
