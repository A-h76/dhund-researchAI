import { assertWorkerPayloadScope } from '../../src/platform/authorization/worker-payload';
import type { AccessContext } from '../../src/platform/authorization/access-context';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('DHB-37 worker payload scope', () => {
  const orgId = generateId();
  const projectId = generateId();
  const otherProject = generateId();
  const context: AccessContext = {
    userId: generateId(),
    orgs: [{ orgId, role: 'MEMBER' }],
    projects: [{ projectId, orgId, role: 'EDITOR' }],
  };

  it('rejects a forged project id from another tenant', () => {
    expectCode(
      () =>
        assertWorkerPayloadScope({ projectId: otherProject, orgId }, context),
      ErrorCode.NotFound,
    );
  });

  it('rejects an org id that does not match the project', () => {
    expectCode(
      () =>
        assertWorkerPayloadScope({ projectId, orgId: generateId() }, context),
      ErrorCode.NotFound,
    );
  });

  it('allows a payload scoped to a membership the user actually has', () => {
    expect(() =>
      assertWorkerPayloadScope({ projectId, orgId }, context),
    ).not.toThrow();
  });
});
