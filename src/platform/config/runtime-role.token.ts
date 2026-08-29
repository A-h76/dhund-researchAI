import { RuntimeRole } from '../runtime/role';

export const RUNTIME_ROLE = Symbol('RUNTIME_ROLE');

export function provideRuntimeRole(role: RuntimeRole) {
  return {
    provide: RUNTIME_ROLE,
    useValue: role,
  };
}
