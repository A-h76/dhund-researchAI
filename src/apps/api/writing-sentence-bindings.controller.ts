import { Controller, Get, Param, Query } from '@nestjs/common';
import { SentenceProjectionService } from '../../evidence/sentence-projection.service';
import { RequireAuth } from '../../iam/authorization/require-auth';
import { DomainError } from '../../platform/errors/domain-error';
import { ErrorCode } from '../../platform/errors/error-codes';

@Controller('v1/writing')
export class WritingSentenceBindingsController {
  constructor(private readonly projection: SentenceProjectionService) {}

  @Get(':writingId/sentence-bindings/:hash')
  @RequireAuth()
  project(
    @Param('writingId') writingId: string,
    @Param('hash') hash: string,
    @Query('projectId') projectId: string | undefined,
  ) {
    if (projectId === undefined || projectId.trim().length === 0) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: 'api',
        userMessage: 'projectId is required.',
      });
    }
    return this.projection.projectSentence({
      writingId,
      sentenceHash: hash,
      projectId: projectId.trim(),
    });
  }
}
