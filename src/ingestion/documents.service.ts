import { Inject, Injectable } from '@nestjs/common';
import { readBearerToken } from '../iam/auth/parse-auth-request';
import { AccessContextService } from '../iam/authorization/access-context.service';
import { AccessTokenService } from '../iam/tokens/access-token.service';
import {
  L0ConnectionError,
  L0OperationError,
  OBJECT_STORAGE_SERVICE,
  ORPHAN_SWEEP_STORE,
  TENANCY_STORE,
  type ObjectStorageService,
  type OrphanSweepStore,
  type TenancyStore,
} from '../l0/ports';
import { authorizeProject } from '../platform/authorization/authorize';
import type { ProjectRole } from '../platform/authorization/roles';
import { DomainError, ErrorCode, notFound } from '../platform/errors';
import { isUuid } from '../platform/ids/uuid-v7';
import { JobEnqueueService } from '../platform/logging';
import {
  CURSOR_SORT,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from '../platform/persistence/cursor';
import { orphanSweepOlderThan } from '../platform/persistence/orphan-sweep.constants';
import { projectScopeFrom } from '../platform/persistence/project-scope';
import {
  DocumentsRepository,
  type DocumentDto,
} from './documents.repository';
import { parseDocumentPatch } from './parse-document-request';
import { PRESIGN_TTL_SECONDS } from './upload.constants';

const MODULE = 'ingestion';

export interface DocumentListResponse {
  readonly items: readonly DocumentDto[];
  readonly nextCursor: string | null;
}

export interface DocumentStatusResponse {
  readonly id: string;
  readonly status: string;
}

export interface DocumentDownloadResponse {
  readonly downloadUrl: string;
  readonly expiresAt: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly accessContext: AccessContextService,
    private readonly documents: DocumentsRepository,
    @Inject(ORPHAN_SWEEP_STORE) private readonly sweepStore: OrphanSweepStore,
    @Inject(OBJECT_STORAGE_SERVICE) private readonly storage: ObjectStorageService,
    @Inject(TENANCY_STORE) private readonly tenancy: TenancyStore,
    private readonly enqueue: JobEnqueueService,
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
    const user = await this.accessTokens.verify(readBearerToken(authorization));
    const context = await this.accessContext.resolve(user.sub);
    const scope = projectScopeFrom(context, projectId, MODULE);
    await this.documents.remove(scope, documentId);
    const membership = context.projects.find((row) => row.projectId === projectId);
    if (membership !== undefined) {
      await this.enqueueSweep(membership.orgId);
    }
  }

  async removeById(
    authorization: string | undefined,
    documentId: string,
  ): Promise<void> {
    const document = await this.requireLive(authorization, documentId, 'EDITOR');
    await this.documents.remove({ projectId: document.projectId }, document.id);
    await this.enqueueSweep(document.orgId);
  }

  async status(
    authorization: string | undefined,
    documentId: string,
  ): Promise<DocumentStatusResponse> {
    const document = await this.requireLive(authorization, documentId, 'VIEWER');
    return { id: document.id, status: document.status };
  }

  async download(
    authorization: string | undefined,
    documentId: string,
  ): Promise<DocumentDownloadResponse> {
    const document = await this.requireLive(authorization, documentId, 'VIEWER');
    try {
      const downloadUrl = await this.storage.getPresignedGetUrl(
        document.storageKey,
        PRESIGN_TTL_SECONDS,
      );
      return {
        downloadUrl,
        expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString(),
      };
    } catch (error) {
      if (error instanceof L0ConnectionError || error instanceof L0OperationError) {
        throw new DomainError(ErrorCode.StorageUnavailable, { module: MODULE });
      }
      throw error;
    }
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

  private async requireLive(
    authorization: string | undefined,
    documentId: string,
    minimum: ProjectRole,
  ) {
    if (!isUuid(documentId)) {
      throw notFound({ module: MODULE });
    }
    const user = await this.accessTokens.verify(readBearerToken(authorization));
    const context = await this.accessContext.resolve(user.sub);
    const document = await this.sweepStore.findLiveById(documentId);
    const liveProject =
      document === null ? null : await this.tenancy.findLiveProject(document.projectId);
    authorizeProject(context, document?.projectId ?? documentId, liveProject, minimum, {
      module: MODULE,
    });
    if (document === null) {
      throw notFound({ module: MODULE });
    }
    return document;
  }

  private async enqueueSweep(orgId: string): Promise<void> {
    await this.enqueue.enqueue('orphan-sweep', {
      orgId,
      olderThan: orphanSweepOlderThan(),
    });
  }

  private async scope(authorization: string | undefined, projectId: string) {
    const user = await this.accessTokens.verify(readBearerToken(authorization));
    const context = await this.accessContext.resolve(user.sub);
    return projectScopeFrom(context, projectId, MODULE);
  }
}
