import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { RequireAuth } from '../iam/authorization/require-auth';
import {
  DocumentsService,
  type DocumentDownloadResponse,
  type DocumentStatusResponse,
} from './documents.service';

@Controller('v1/documents')
export class DocumentAccessController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':id/status')
  @RequireAuth()
  status(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DocumentStatusResponse> {
    return this.documents.status(authorization, id);
  }

  @Get(':id/download')
  @RequireAuth()
  download(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DocumentDownloadResponse> {
    return this.documents.download(authorization, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAuth()
  remove(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    return this.documents.removeById(authorization, id);
  }
}
