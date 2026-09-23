import { Inject, Injectable } from '@nestjs/common';
import { readBearerToken } from '../iam/auth/parse-auth-request';
import { AccessContextService } from '../iam/authorization/access-context.service';
import { AccessTokenService } from '../iam/tokens/access-token.service';
import { L0OperationError } from '../l0/ports/errors';
import {
  LIBRARY_STORE,
  type LibraryDocumentTarget,
  type LibraryExternalTarget,
  type LibraryFolderRecord,
  type LibraryItemRecord,
  type LibraryStore,
} from '../l0/ports/library.port';
import { DomainError, ErrorCode, notFound } from '../platform/errors';
import { generateId, isUuid } from '../platform/ids/uuid-v7';
import { projectScopeFrom } from '../platform/persistence/project-scope';
import { LibraryMetrics } from './library.metrics';
import {
  parseLibraryFolderCreate,
  parseLibraryFolderPatch,
  parseLibraryItemCreate,
  parseLibraryItemPatch,
} from './parse-library-request';

const MODULE = 'ingestion';

export interface LibraryFolderDto {
  readonly id: string;
  readonly projectId: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly position: number;
}

export interface LibraryItemDto {
  readonly id: string;
  readonly projectId: string;
  readonly folderId: string | null;
  readonly position: number;
  readonly note: string | null;
  readonly target:
    | { readonly type: 'document'; readonly id: string }
    | { readonly type: 'external_record'; readonly id: string };
  readonly title: string | null;
  readonly authors: readonly string[];
  readonly year: number | null;
}

@Injectable()
export class LibraryService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly accessContext: AccessContextService,
    @Inject(LIBRARY_STORE) private readonly store: LibraryStore,
    private readonly metrics: LibraryMetrics,
  ) {}

  async createFolder(authorization: string | undefined, projectId: string, body: unknown) {
    const parsed = parseLibraryFolderCreate(body);
    const scope = await this.scope(authorization, projectId);
    await this.requireFolder(scope.projectId, parsed.parentFolderId);
    const row = await this.guard(this.store.insertFolder({
      id: generateId(),
      projectId: scope.projectId,
      parentFolderId: parsed.parentFolderId,
      name: parsed.name,
      position: parsed.position,
    }));
    this.metrics.recordFolder('create');
    return toFolderDto(row);
  }

  async listFolders(authorization: string | undefined, projectId: string) {
    const scope = await this.scope(authorization, projectId);
    const rows = await this.store.listFolders(scope.projectId);
    return { folders: rows.map(toFolderDto) };
  }

  async updateFolder(
    authorization: string | undefined,
    projectId: string,
    folderId: string,
    body: unknown,
  ) {
    const parsed = parseLibraryFolderPatch(body);
    const scope = await this.scope(authorization, projectId);
    this.requireUuid(folderId);
    if (parsed.parentFolderId !== undefined) {
      await this.requireFolder(scope.projectId, parsed.parentFolderId);
    }
    const row = await this.guard(
      this.store.updateFolder(scope.projectId, folderId, parsed),
    );
    if (row === null) {
      throw notFound({ module: MODULE });
    }
    this.metrics.recordFolder('update');
    return toFolderDto(row);
  }

  async deleteFolder(
    authorization: string | undefined,
    projectId: string,
    folderId: string,
  ): Promise<void> {
    const scope = await this.scope(authorization, projectId);
    this.requireUuid(folderId);
    const deleted = await this.store.deleteFolder(scope.projectId, folderId);
    if (!deleted) {
      throw notFound({ module: MODULE });
    }
    this.metrics.recordFolder('delete');
  }

  async createItem(authorization: string | undefined, projectId: string, body: unknown) {
    const parsed = parseLibraryItemCreate(body);
    const scope = await this.scope(authorization, projectId);
    await this.requireFolder(scope.projectId, parsed.folderId);
    if (parsed.documentId !== null) {
      await this.requireDocument(scope.projectId, parsed.documentId);
    } else if (parsed.externalRecordId !== null) {
      await this.requireExternal(scope.projectId, parsed.externalRecordId);
    }
    const row = await this.guard(this.store.insertItem({
      id: generateId(),
      projectId: scope.projectId,
      folderId: parsed.folderId,
      documentId: parsed.documentId,
      externalRecordId: parsed.externalRecordId,
      position: parsed.position,
      metadata: parsed.note === null ? {} : { note: parsed.note },
    }));
    this.metrics.recordItem(row.documentId === null ? 'external_record' : 'document');
    return this.toItemDto(row);
  }

  async listItems(authorization: string | undefined, projectId: string) {
    const scope = await this.scope(authorization, projectId);
    const rows = await this.store.listItems(scope.projectId);
    const items: LibraryItemDto[] = [];
    for (const row of rows) {
      items.push(await this.toItemDto(row));
    }
    return { items };
  }

  async updateItem(
    authorization: string | undefined,
    projectId: string,
    itemId: string,
    body: unknown,
  ) {
    const parsed = parseLibraryItemPatch(body);
    const scope = await this.scope(authorization, projectId);
    this.requireUuid(itemId);
    if (parsed.folderId !== undefined) {
      await this.requireFolder(scope.projectId, parsed.folderId);
    }
    const current = await this.store.findItem(scope.projectId, itemId);
    if (current === null) {
      throw notFound({ module: MODULE });
    }
    const metadata =
      parsed.note === undefined ? undefined : { ...current.metadata, note: parsed.note };
    const row = await this.guard(
      this.store.updateItem(scope.projectId, itemId, {
        folderId: parsed.folderId,
        position: parsed.position,
        metadata,
      }),
    );
    if (row === null) {
      throw notFound({ module: MODULE });
    }
    return this.toItemDto(row);
  }

  async deleteItem(
    authorization: string | undefined,
    projectId: string,
    itemId: string,
  ): Promise<void> {
    const scope = await this.scope(authorization, projectId);
    this.requireUuid(itemId);
    const deleted = await this.store.deleteItem(scope.projectId, itemId);
    if (!deleted) {
      throw notFound({ module: MODULE });
    }
  }

  private async toItemDto(row: LibraryItemRecord): Promise<LibraryItemDto> {
    const bibliography = await this.bibliography(row);
    const target =
      row.documentId !== null
        ? ({ type: 'document', id: row.documentId } as const)
        : ({ type: 'external_record', id: row.externalRecordId ?? '' } as const);
    return {
      id: row.id,
      projectId: row.projectId,
      folderId: row.folderId,
      position: row.position,
      note: row.metadata.note ?? null,
      target,
      title: bibliography.title,
      authors: bibliography.authors,
      year: bibliography.year,
    };
  }

  private async bibliography(row: LibraryItemRecord): Promise<{
    title: string | null;
    authors: readonly string[];
    year: number | null;
  }> {
    if (row.documentId !== null) {
      const document = await this.store.findDocument(row.projectId, row.documentId);
      return document === null
        ? { title: null, authors: [], year: null }
        : { title: document.title, authors: document.authors, year: document.year };
    }
    if (row.externalRecordId !== null) {
      const external = await this.store.findExternal(row.projectId, row.externalRecordId);
      return external === null
        ? { title: null, authors: [], year: null }
        : { title: external.title, authors: external.authors, year: external.year };
    }
    return { title: null, authors: [], year: null };
  }

  private async requireDocument(projectId: string, documentId: string): Promise<LibraryDocumentTarget> {
    this.requireUuid(documentId);
    const document = await this.store.findDocument(projectId, documentId);
    if (document === null) {
      throw notFound({ module: MODULE });
    }
    return document;
  }

  private async requireExternal(
    projectId: string,
    externalRecordId: string,
  ): Promise<LibraryExternalTarget> {
    this.requireUuid(externalRecordId);
    const external = await this.store.findExternal(projectId, externalRecordId);
    if (external === null) {
      throw notFound({ module: MODULE });
    }
    return external;
  }

  private async requireFolder(projectId: string, folderId: string | null | undefined): Promise<void> {
    if (folderId === undefined || folderId === null) {
      return;
    }
    this.requireUuid(folderId);
    const folder = await this.store.findFolder(projectId, folderId);
    if (folder === null) {
      throw notFound({ module: MODULE });
    }
  }

  private requireUuid(id: string): void {
    if (!isUuid(id)) {
      throw notFound({ module: MODULE });
    }
  }

  private async scope(authorization: string | undefined, projectId: string) {
    const user = await this.accessTokens.verify(readBearerToken(authorization));
    const context = await this.accessContext.resolve(user.sub);
    return projectScopeFrom(context, projectId, MODULE);
  }

  private async guard<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof L0OperationError && error.message.includes('already exists')) {
        throw new DomainError(ErrorCode.AlreadyExists, { module: MODULE });
      }
      throw error;
    }
  }
}

function toFolderDto(row: LibraryFolderRecord): LibraryFolderDto {
  return {
    id: row.id,
    projectId: row.projectId,
    parentFolderId: row.parentFolderId,
    name: row.name,
    position: row.position,
  };
}
