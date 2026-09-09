import { SetMetadata } from '@nestjs/common';
import type { OrgDataRole } from '../../platform/authorization/roles';

export const REQUIRE_ORG_ROLE_KEY = 'dhund.requireOrgRole';

export function RequireOrgRole(role: OrgDataRole): MethodDecorator {
  return SetMetadata(REQUIRE_ORG_ROLE_KEY, role);
}
