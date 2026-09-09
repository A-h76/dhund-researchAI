import type { AccessContext } from '../../src/platform/authorization/access-context';
import {
  authorizeOrg,
  authorizeProject,
} from '../../src/platform/authorization/authorize';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';

function snapshot(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    userId: generateId(),
    orgs: [],
    projects: [],
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('DHB-37 authorize helpers', () => {
  const orgId = generateId();
  const projectId = generateId();

  it('returns 404 for unknown org, non-members, and deleted orgs', () => {
    const userId = generateId();
    const member = snapshot({
      userId,
      orgs: [{ orgId, role: 'MEMBER' }],
    });
    expectCode(
      () => authorizeOrg(snapshot({ userId }), orgId, { id: orgId }, 'MEMBER'),
      ErrorCode.NotFound,
    );
    expectCode(
      () => authorizeOrg(member, generateId(), { id: generateId() }, 'MEMBER'),
      ErrorCode.NotFound,
    );
    expectCode(
      () => authorizeOrg(member, orgId, null, 'MEMBER'),
      ErrorCode.NotFound,
    );
  });

  it('returns 403 when the org role is too low, including BILLING', () => {
    const userId = generateId();
    expectCode(
      () =>
        authorizeOrg(
          snapshot({ userId, orgs: [{ orgId, role: 'BILLING' }] }),
          orgId,
          { id: orgId },
          'MEMBER',
        ),
      ErrorCode.Forbidden,
    );
    expectCode(
      () =>
        authorizeOrg(
          snapshot({ userId, orgs: [{ orgId, role: 'MEMBER' }] }),
          orgId,
          { id: orgId },
          'ADMIN',
        ),
      ErrorCode.Forbidden,
    );
  });

  it('allows org ADMIN for ADMIN routes', () => {
    const userId = generateId();
    expect(
      authorizeOrg(
        snapshot({ userId, orgs: [{ orgId, role: 'ADMIN' }] }),
        orgId,
        { id: orgId },
        'ADMIN',
      ).role,
    ).toBe('ADMIN');
  });

  it('returns 404 without project membership and for BILLING even with one', () => {
    const live = { id: projectId, orgId };
    expectCode(
      () =>
        authorizeProject(
          snapshot({ orgs: [{ orgId, role: 'ADMIN' }] }),
          projectId,
          live,
          'VIEWER',
        ),
      ErrorCode.NotFound,
    );
    expectCode(
      () =>
        authorizeProject(
          snapshot({
            orgs: [{ orgId, role: 'BILLING' }],
            projects: [{ projectId, orgId, role: 'OWNER' }],
          }),
          projectId,
          live,
          'VIEWER',
        ),
      ErrorCode.NotFound,
    );
  });

  it('returns 403 when the project role is too low', () => {
    expectCode(
      () =>
        authorizeProject(
          snapshot({
            orgs: [{ orgId, role: 'MEMBER' }],
            projects: [{ projectId, orgId, role: 'VIEWER' }],
          }),
          projectId,
          { id: projectId, orgId },
          'EDITOR',
        ),
      ErrorCode.Forbidden,
    );
  });

  it('does not resurrect a soft-deleted project from cached membership', () => {
    expectCode(
      () =>
        authorizeProject(
          snapshot({
            orgs: [{ orgId, role: 'MEMBER' }],
            projects: [{ projectId, orgId, role: 'OWNER' }],
          }),
          projectId,
          null,
          'VIEWER',
        ),
      ErrorCode.NotFound,
    );
  });

  it('allows org OWNER break-glass only when requested and there is no project membership', () => {
    const live = { id: projectId, orgId };
    expect(
      authorizeProject(
        snapshot({ orgs: [{ orgId, role: 'OWNER' }] }),
        projectId,
        live,
        'OWNER',
        { allowOrgOwnerBreakGlass: true },
      ).role,
    ).toBe('OWNER');
    expectCode(
      () =>
        authorizeProject(
          snapshot({ orgs: [{ orgId, role: 'OWNER' }] }),
          projectId,
          live,
          'VIEWER',
        ),
      ErrorCode.NotFound,
    );
    expectCode(
      () =>
        authorizeProject(
          snapshot({ orgs: [{ orgId, role: 'ADMIN' }] }),
          projectId,
          live,
          'OWNER',
          { allowOrgOwnerBreakGlass: true },
        ),
      ErrorCode.NotFound,
    );
  });
});
