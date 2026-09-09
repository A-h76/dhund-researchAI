import { SetMetadata } from '@nestjs/common';
import type { ProjectRole } from '../../platform/authorization/roles';

export const REQUIRE_PROJECT_ROLE_KEY = 'dhund.requireProjectRole';

export function RequireProjectRole(role: ProjectRole): MethodDecorator {
  return SetMetadata(REQUIRE_PROJECT_ROLE_KEY, role);
}
