import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequireOrgRole } from '../iam/authorization/require-org-role';
import {
  TenancyService,
  type OrgResponse,
  type ProjectResponse,
} from './tenancy.service';

@Controller('v1/orgs')
export class OrgsController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get(':orgId')
  @RequireOrgRole('MEMBER')
  getOrg(
    @Param('orgId') orgId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<OrgResponse> {
    return this.tenancy.getOrg(authorization, orgId);
  }

  @Patch(':orgId')
  @RequireOrgRole('ADMIN')
  patchOrg(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<OrgResponse> {
    return this.tenancy.patchOrg(authorization, orgId, body);
  }

  @Post(':orgId/projects')
  @HttpCode(HttpStatus.CREATED)
  @RequireOrgRole('ADMIN')
  createProject(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ProjectResponse> {
    return this.tenancy.createProject(authorization, orgId, body);
  }
}
