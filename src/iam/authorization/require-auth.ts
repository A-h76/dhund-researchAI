import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AccessAuthGuard } from './access-auth.guard';
import { REQUIRE_AUTH_KEY } from './metadata';

export function RequireAuth(): MethodDecorator {
  return applyDecorators(
    SetMetadata(REQUIRE_AUTH_KEY, true),
    UseGuards(AccessAuthGuard),
  );
}
