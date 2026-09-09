import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequireProjectRole } from '../iam/authorization/require-project-role';
import { TenancyService, type MembershipResponse } from './tenancy.service';

@Controller('v1/projects/:projectId/memberships')
export class MembershipsController {
  constructor(private readonly tenancy: TenancyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireProjectRole('ADMIN')
  grant(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<MembershipResponse> {
    return this.tenancy.grantMembership(authorization, projectId, body);
  }

  @Patch(':membershipId')
  @RequireProjectRole('ADMIN')
  patch(
    @Param('projectId') projectId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<MembershipResponse> {
    return this.tenancy.patchMembership(
      authorization,
      projectId,
      membershipId,
      body,
    );
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole('ADMIN')
  revoke(
    @Param('projectId') projectId: string,
    @Param('membershipId') membershipId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    return this.tenancy.revokeMembership(
      authorization,
      projectId,
      membershipId,
    );
  }
}
