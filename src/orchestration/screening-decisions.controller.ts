import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { RequireProjectRole } from '../iam/authorization/require-project-role';
import {
  ScreeningStubService,
  type ScreeningDecisionDto,
} from './screening-stub.service';

/**
 * R1 screening stub — records and reads decisions only.
 * Criteria CRUD / versioning / screening queue are R2 (GAP-CAT-A-01 P2).
 */
@Controller('v1/projects/:projectId/screening/decisions')
export class ScreeningDecisionsController {
  constructor(private readonly screening: ScreeningStubService) {}

  @Post()
  @RequireProjectRole('EDITOR')
  record(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ScreeningDecisionDto> {
    return this.screening.recordDecision(authorization, projectId, body);
  }

  @Get()
  @RequireProjectRole('VIEWER')
  list(
    @Param('projectId') projectId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<readonly ScreeningDecisionDto[]> {
    return this.screening.listDecisions(authorization, projectId);
  }

  @Get(':decisionId')
  @RequireProjectRole('VIEWER')
  get(
    @Param('projectId') projectId: string,
    @Param('decisionId') decisionId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ScreeningDecisionDto> {
    return this.screening.getDecision(authorization, projectId, decisionId);
  }

  @Post(':decisionId/reverse')
  @RequireProjectRole('EDITOR')
  reverse(
    @Param('projectId') projectId: string,
    @Param('decisionId') decisionId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ScreeningDecisionDto> {
    return this.screening.reverseDecision(authorization, projectId, decisionId, body);
  }
}
