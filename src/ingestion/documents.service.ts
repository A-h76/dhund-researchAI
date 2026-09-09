import { Injectable } from '@nestjs/common';
import { readBearerToken } from '../iam/auth/parse-auth-request';
import { AccessContextService } from '../iam/authorization/access-context.service';
import { AccessTokenService } from '../iam/tokens/access-token.service';
import {
  CURSOR_SORT,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from '../platform/persistence/cursor';
import { projectScopeFrom } from '../platform/persistence/project-scope';
import {
  DocumentsRepository,
  type DocumentDto,
} from './documents.repository';
import { parseDocumentPatch } from './parse-document-request';

const MODULE = 'ingestion';

export interface DocumentListResponse {
  readonly items: readonly DocumentDto[];
  readonly nextCursor: string | null;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly accessContext: AccessContextService,
    private readonly documents: DocumentsRepository,
  ) {}

  async get(
    authorization: string | undefined,
    projectId: string,
    documentId: string,
  ): Promise<DocumentDto> {
    const scope = await this.scope(authorization, projectId);
    return this.documents.get(scope, documentId);
  }

  async patch(
    authorization: string | undefined,
    projectId: string,
    documentId: string,
    body: unknown,
  ): Promise<DocumentDto> {
    const parsed = parseDocumentPatch(body);
    const scope = await this.scope(authorization, projectId);
    return this.documents.update(scope, documentId, { title: parsed.title });
  }

  async remove(
    authorization: string | undefined,
    projectId: string,
    documentId: string,
  ): Promise<void> {
    const scope = await this.scope(authorization, projectId);
    await this.documents.remove(scope, documentId);
  }

  async list(
    authorization: string | undefined,
    projectId: string,
    limitRaw: unknown,
    cursorRaw: unknown,
  ): Promise<DocumentListResponse> {
    const scope = await this.scope(authorization, projectId);
    const limit = parseLimit(limitRaw, MODULE);
    const afterId =
      cursorRaw === undefined || cursorRaw === null || cursorRaw === ''
        ? undefined
        : decodeCursor(String(cursorRaw), CURSOR_SORT, MODULE).id;
    const items = await this.documents.list(scope, { limit, afterId });
    const nextCursor =
      items.length === limit ? encodeCursor(items[items.length - 1].id) : null;
    return { items, nextCursor };
  }

  private async scope(authorization: string | undefined, projectId: string) {
    const user = await this.accessTokens.verify(readBearerToken(authorization));
    const context = await this.accessContext.resolve(user.sub);
    return projectScopeFrom(context, projectId, MODULE);
  }
}
