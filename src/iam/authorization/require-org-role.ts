import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { OrgDataRole } from '../../platform/authorization/roles';
import { AccessAuthGuard } from './access-auth.guard';
import { REQUIRE_ORG_ROLE_KEY } from './metadata';
import { OrgRoleGuard } from './org-role.guard';

export { REQUIRE_ORG_ROLE_KEY };

export function RequireOrgRole(role: OrgDataRole): MethodDecorator {
  return applyDecorators(
    SetMetadata(REQUIRE_ORG_ROLE_KEY, role),
    UseGuards(AccessAuthGuard, OrgRoleGuard),
  );
}
