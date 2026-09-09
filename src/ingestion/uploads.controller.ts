import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { RequireAuth } from '../iam/authorization/require-auth';
import { RequireProjectRole } from '../iam/authorization/require-project-role';
import {
  UploadsService,
  type UploadCompleteResponse,
  type UploadSessionResponse,
} from './uploads.service';

@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('v1/projects/:projectId/uploads')
  @RequireProjectRole('EDITOR')
  create(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<UploadSessionResponse> {
    return this.uploads.create(authorization, projectId, body, idempotencyKey);
  }

  @Post('v1/uploads/:sessionId/complete')
  @HttpCode(HttpStatus.OK)
  @RequireAuth()
  complete(
    @Param('sessionId') sessionId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<UploadCompleteResponse> {
    return this.uploads.complete(authorization, sessionId);
  }
}
