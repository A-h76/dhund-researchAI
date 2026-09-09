import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { RequireProjectRole } from '../iam/authorization/require-project-role';
import {
  DocumentsService,
  type DocumentListResponse,
} from './documents.service';
import type { DocumentDto } from './documents.repository';

@Controller('v1/projects/:projectId/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequireProjectRole('VIEWER')
  list(
    @Param('projectId') projectId: string,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DocumentListResponse> {
    return this.documents.list(authorization, projectId, limit, cursor);
  }

  @Get(':documentId')
  @RequireProjectRole('VIEWER')
  get(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DocumentDto> {
    return this.documents.get(authorization, projectId, documentId);
  }

  @Patch(':documentId')
  @RequireProjectRole('EDITOR')
  patch(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DocumentDto> {
    return this.documents.patch(authorization, projectId, documentId, body);
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole('EDITOR')
  remove(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    return this.documents.remove(authorization, projectId, documentId);
  }
}
