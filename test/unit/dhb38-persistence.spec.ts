import { DomainError } from '../../src/platform/errors';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { generateId } from '../../src/platform/ids/uuid-v7';
import {
  CURSOR_SORT,
  CURSOR_VERSION,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from '../../src/platform/persistence/cursor';
import { pickDto } from '../../src/platform/persistence/pick-dto';
import { projectScopeFrom } from '../../src/platform/persistence/project-scope';
import type { AccessContext } from '../../src/platform/authorization/access-context';

function expectPaginationInvalid(fn: () => unknown): void {
  try {
    fn();
    throw new Error('expected pagination_invalid');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected pagination_invalid') {
      throw error;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(ErrorCode.PaginationInvalid);
  }
}

describe('DHB-38 cursor, DTO pick, and project scope', () => {
  it('round-trips an opaque Base64URL cursor', () => {
    const id = generateId();
    const encoded = encodeCursor(id);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual({ id });
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as { v: number; sort: string; id: string };
    expect(payload).toEqual({ v: CURSOR_VERSION, sort: CURSOR_SORT, id });
  });

  it('rejects unknown version, wrong sort, and limit above 100', () => {
    const id = generateId();
    const unknownV = Buffer.from(
      JSON.stringify({ v: 99, sort: CURSOR_SORT, id }),
      'utf8',
    ).toString('base64url');
    const wrongSort = Buffer.from(
      JSON.stringify({ v: CURSOR_VERSION, sort: 'createdAt', id }),
      'utf8',
    ).toString('base64url');
    expectPaginationInvalid(() => decodeCursor(unknownV));
    expectPaginationInvalid(() => decodeCursor(wrongSort));
    expectPaginationInvalid(() => decodeCursor('%%%'));
    expectPaginationInvalid(() => parseLimit(101));
    expectPaginationInvalid(() => parseLimit(0));
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('12')).toBe(12);
  });

  it('strips undeclared fields from DTOs', () => {
    const id = generateId();
    const projectId = generateId();
    const dto = pickDto(
      {
        id,
        projectId,
        title: 'Paper',
        status: 'queued',
        createdAt: '2026-01-01T00:00:00.000Z',
        storageKey: 'secret/key',
      },
      ['id', 'projectId', 'title', 'status', 'createdAt'] as const,
    );
    expect(dto).toEqual({
      id,
      projectId,
      title: 'Paper',
      status: 'queued',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(dto).not.toHaveProperty('storageKey');
  });

  it('builds scope only from AccessContext membership, never BILLING', () => {
    const orgId = generateId();
    const projectId = generateId();
    const otherProject = generateId();
    const context: AccessContext = {
      userId: generateId(),
      orgs: [{ orgId, role: 'MEMBER' }],
      projects: [{ projectId, orgId, role: 'EDITOR' }],
    };
    expect(projectScopeFrom(context, projectId, 'ingestion')).toEqual({
      projectId,
    });
    try {
      projectScopeFrom(context, otherProject, 'ingestion');
      throw new Error('expected not_found');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ErrorCode.NotFound);
    }
    const billing: AccessContext = {
      userId: context.userId,
      orgs: [{ orgId, role: 'BILLING' }],
      projects: [{ projectId, orgId, role: 'VIEWER' }],
    };
    try {
      projectScopeFrom(billing, projectId, 'ingestion');
      throw new Error('expected not_found');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(ErrorCode.NotFound);
    }
  });
});
