import { ErrorCode } from '../../src/platform/errors';
import { ScreeningDecisionsRepository } from '../../src/orchestration/scoped-repos';
import { ScreeningStubService } from '../../src/orchestration/screening-stub.service';
import { ScreeningMetrics } from '../../src/orchestration/screening.metrics';
import type { ProjectScope, ScopedRow, ScopedStore } from '../../src/l0/ports';
import { DomainError } from '../../src/platform/errors';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { PlatformLogger } from '../../src/platform/logging/platform-logger.service';
import type { OutboxWriterService } from '../../src/platform/events';
import type { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import type { AccessContextService } from '../../src/iam/authorization/access-context.service';

describe('DHB-69 screening stub (R1)', () => {
  const projectId = generateId();
  const userId = generateId();
  const orgId = generateId();
  const sourceId = generateId();

  function logger() {
    return {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as PlatformLogger;
  }

  function buildService(store: InMemoryScreeningStore) {
    const repo = new ScreeningDecisionsRepository(
      {
        require: async (_entity: string, scope: ProjectScope, id: string) => {
          const row = store.rows.get(id);
          if (row === undefined || row.projectId !== scope.projectId) {
            throw new DomainError(ErrorCode.NotFound, { module: 'orchestration' });
          }
          return row;
        },
        update: async (
          _entity: string,
          scope: ProjectScope,
          id: string,
          patch: Record<string, unknown>,
        ) => {
          const row = store.rows.get(id);
          if (row === undefined || row.projectId !== scope.projectId) {
            throw new DomainError(ErrorCode.NotFound, { module: 'orchestration' });
          }
          const next = { ...row, ...patch };
          store.rows.set(id, next);
          return next;
        },
        list: async (_entity: string, scope: ProjectScope) =>
          [...store.rows.values()].filter((row) => row.projectId === scope.projectId),
        remove: async () => {
          throw new Error('append-only');
        },
      } as never,
      store as unknown as ScopedStore,
    );

    return new ScreeningStubService(
      {
        verify: async () => ({ sub: userId }),
      } as unknown as AccessTokenService,
      {
        resolve: async () => ({
          projects: [{ projectId, orgId, role: 'EDITOR' }],
          orgs: [{ orgId, role: 'OWNER' }],
        }),
      } as unknown as AccessContextService,
      repo,
      {
        write: jest.fn(async () => ({})),
      } as unknown as OutboxWriterService,
      new ScreeningMetrics(),
      logger(),
    );
  }

  it('records a human decision as method=deterministic and makes it readable', async () => {
    const store = new InMemoryScreeningStore();
    const service = buildService(store);
    const created = await service.recordDecision('Bearer t', projectId, {
      sourceId,
      decision: 'include',
      reason: 'on-topic',
    });

    expect(created.method).toBe('deterministic');
    expect(created.aiExecutionId).toBeNull();
    expect(created.decision).toBe('include');

    const loaded = await service.getDecision('Bearer t', projectId, created.id);
    expect(loaded.id).toBe(created.id);
    expect(loaded.decision).toBe('include');
  });

  it('reverses by inserting a superseding row and leaving the original decision fields unchanged', async () => {
    const store = new InMemoryScreeningStore();
    const service = buildService(store);
    const original = await service.recordDecision('Bearer t', projectId, {
      sourceId,
      decision: 'include',
      reason: 'first pass',
    });

    const successor = await service.reverseDecision('Bearer t', projectId, original.id, {
      decision: 'exclude',
      reason: 'changed mind',
    });

    const originalAfter = store.rows.get(original.id)!;
    expect(originalAfter.decision).toBe('include');
    expect(originalAfter.reason).toBe('first pass');
    expect(originalAfter.supersededByDecisionId).toBe(successor.id);
    expect(successor.decision).toBe('exclude');
    expect(successor.id).not.toBe(original.id);
  });
});

class InMemoryScreeningStore {
  readonly rows = new Map<string, ScopedRow>();

  async insert(
    _entity: string,
    scope: ProjectScope,
    row: Record<string, unknown>,
  ): Promise<ScopedRow> {
    const created: ScopedRow = {
      id: String(row.id),
      projectId: scope.projectId,
      ...row,
    };
    this.rows.set(String(row.id), created);
    return created;
  }
}
