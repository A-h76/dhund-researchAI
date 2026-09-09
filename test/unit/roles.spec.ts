import {
  canAssignProjectRole,
  orgRoleAtLeast,
  projectRoleAtLeast,
} from '../../src/platform/authorization/roles';

describe('DHB-36 role ladders', () => {
  it('orders project roles OWNER > ADMIN > EDITOR > VIEWER', () => {
    expect(projectRoleAtLeast('OWNER', 'ADMIN')).toBe(true);
    expect(projectRoleAtLeast('ADMIN', 'EDITOR')).toBe(true);
    expect(projectRoleAtLeast('EDITOR', 'VIEWER')).toBe(true);
    expect(projectRoleAtLeast('VIEWER', 'EDITOR')).toBe(false);
    expect(projectRoleAtLeast('EDITOR', 'ADMIN')).toBe(false);
  });

  it('orders org data roles OWNER > ADMIN > MEMBER', () => {
    expect(orgRoleAtLeast('OWNER', 'ADMIN')).toBe(true);
    expect(orgRoleAtLeast('ADMIN', 'MEMBER')).toBe(true);
    expect(orgRoleAtLeast('MEMBER', 'ADMIN')).toBe(false);
  });

  it('never lets BILLING satisfy a data-ladder check', () => {
    expect(orgRoleAtLeast('BILLING', 'MEMBER')).toBe(false);
    expect(orgRoleAtLeast('BILLING', 'ADMIN')).toBe(false);
    expect(orgRoleAtLeast('BILLING', 'OWNER')).toBe(false);
    expect(projectRoleAtLeast('BILLING', 'VIEWER')).toBe(false);
  });

  it('rejects assigning a project role above the caller', () => {
    expect(canAssignProjectRole('ADMIN', 'OWNER')).toBe(false);
    expect(canAssignProjectRole('ADMIN', 'ADMIN')).toBe(true);
    expect(canAssignProjectRole('EDITOR', 'VIEWER')).toBe(true);
    expect(canAssignProjectRole('VIEWER', 'EDITOR')).toBe(false);
  });
});
