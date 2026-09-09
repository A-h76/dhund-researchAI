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
} from '@nestjs/common';
import { RequireProjectRole } from '../iam/authorization/require-project-role';
import { TenancyService, type ProjectResponse } from './tenancy.service';

@Controller('v1/projects')
export class ProjectsController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get(':projectId')
  @RequireProjectRole('VIEWER')
  getProject(
    @Param('projectId') projectId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ProjectResponse> {
    return this.tenancy.getProject(authorization, projectId);
  }

  @Patch(':projectId')
  @RequireProjectRole('EDITOR')
  patchProject(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ProjectResponse> {
    return this.tenancy.patchProject(authorization, projectId, body);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole('OWNER')
  deleteProject(
    @Param('projectId') projectId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    return this.tenancy.deleteProject(authorization, projectId);
  }
}
