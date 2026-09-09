import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { ProjectRole } from '../../platform/authorization/roles';
import { AccessAuthGuard } from './access-auth.guard';
import { REQUIRE_PROJECT_ROLE_KEY } from './metadata';
import { ProjectRoleGuard } from './project-role.guard';

export { REQUIRE_PROJECT_ROLE_KEY };

export function RequireProjectRole(role: ProjectRole): MethodDecorator {
  return applyDecorators(
    SetMetadata(REQUIRE_PROJECT_ROLE_KEY, role),
    UseGuards(AccessAuthGuard, ProjectRoleGuard),
  );
}
