import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { RequireProjectRole } from '../iam/authorization/require-project-role';
import { RetrievalSearchService } from './retrieval-search.service';
import type { RetrievalSearchResponse } from './search-dto';

@Controller('v1/projects/:projectId/retrieval/search')
export class RetrievalSearchController {
  constructor(private readonly searchService: RetrievalSearchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireProjectRole('VIEWER')
  search(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<RetrievalSearchResponse> {
    return this.searchService.search(authorization, projectId, body);
  }
}
