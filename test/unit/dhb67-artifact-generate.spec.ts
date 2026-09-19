import { GatewayExecutionFailedError } from '../../src/ai/gateway/gateway-execution.errors';
import {
  emptyResearchRunCoverage,
  hashResearchRunCoverage,
  type ResearchRunCoverage,
} from '../../src/l0/ports/research-run-coverage';
import { ResearchArtifactGenerateService } from '../../src/orchestration/research-artifact-generate.service';
import { ResearchRunMetrics } from '../../src/orchestration/research-run.metrics';
import type { PlatformLogger } from '../../src/platform/logging';
import { MemoryResearchRunStore } from '../fixtures/memory-research-run-store';

const coverage: ResearchRunCoverage = {
  schemaVersion: 1,
  discovery: {
    requested: 4,
    discovered: 4,
    eligible: 3,
    excluded: 1,
    included: 3,
  },
  processing: {
    requested: 3,
    admitted: 3,
    completed: 3,
    partial: 0,
    failed: 0,
    unresolved: 0,
  },
};

describe('DHB-67 research-artifact-generate', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const projectId = '22222222-2222-4222-8222-222222222222';

  function createService(options?: {
    readonly gatewayExecute?: jest.Mock;
    readonly artifacts?: {
      findByCoverageHash: jest.Mock;
      create: jest.Mock;
    };
  }) {
    const store = new MemoryResearchRunStore();
    store.seed({ id: 'run-1', orgId, projectId, coverage });
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as PlatformLogger;
    const metrics = new ResearchRunMetrics(logger);
    const artifacts = options?.artifacts ?? {
      findByCoverageHash: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (_scope, row) => row),
    };
    const gateway = {
      execute:
        options?.gatewayExecute ??
        jest.fn().mockResolvedValue({
          capability: 'SYNTHESIS',
          text: 'report',
          aiExecutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          method: 'llm',
          metrics: { latencyMs: 1, tokensIn: 1, tokensOut: 1, costMicros: 1 },
        }),
    };
    const service = new ResearchArtifactGenerateService(
      store,
      gateway as never,
      artifacts as never,
      metrics,
      logger,
    );
    return { service, artifacts, gateway, metrics, store };
  }

  it('freezes coverage snapshot hash that is stable and changes on any field', () => {
    const a = hashResearchRunCoverage(coverage);
    const b = hashResearchRunCoverage({ ...coverage });
    expect(a).toBe(b);
    expect(
      hashResearchRunCoverage({
        ...coverage,
        discovery: { ...coverage.discovery, included: 2 },
      }),
    ).not.toBe(a);
  });

  it('creates an artifact with aiExecutionId under the frozen snapshot', async () => {
    const { service, artifacts } = createService();
    const hash = hashResearchRunCoverage(coverage);
    const outcome = await service.execute({
      orgId,
      projectId,
      runId: 'run-1',
      artifactType: 'deep_research_report',
      coverageSnapshotHash: hash,
      coverageSnapshot: coverage,
      correlationId: 'corr-art',
    });
    expect(outcome.kind).toBe('created');
    expect(artifacts.create).toHaveBeenCalledWith(
      { projectId },
      expect.objectContaining({
        runId: 'run-1',
        type: 'deep_research_report',
        coverageSnapshotHash: hash,
        coverageSnapshot: coverage,
        aiExecutionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    );
  });

  it('generation failure produces no artifact row', async () => {
    const { service, artifacts, metrics } = createService({
      gatewayExecute: jest
        .fn()
        .mockRejectedValue(new GatewayExecutionFailedError('exec-fail', ['boom'])),
    });
    const hash = hashResearchRunCoverage(coverage);
    await expect(
      service.execute({
        orgId,
        projectId,
        runId: 'run-1',
        artifactType: 'deep_research_report',
        coverageSnapshotHash: hash,
        coverageSnapshot: coverage,
        correlationId: 'corr-fail',
      }),
    ).rejects.toBeInstanceOf(GatewayExecutionFailedError);
    expect(artifacts.create).not.toHaveBeenCalled();
    expect(metrics.snapshot().artifactsFailedCount).toBe(1);
    expect(metrics.snapshot().artifactsGeneratedCount).toBe(0);
  });

  it('does not retroactively alter a frozen snapshot when run coverage later changes', async () => {
    const { service, artifacts, store } = createService();
    const hash = hashResearchRunCoverage(coverage);
    await service.execute({
      orgId,
      projectId,
      runId: 'run-1',
      artifactType: 'deep_research_report',
      coverageSnapshotHash: hash,
      coverageSnapshot: coverage,
      correlationId: 'corr-freeze',
    });
    const created = artifacts.create.mock.calls[0]?.[1] as {
      coverageSnapshot: ResearchRunCoverage;
    };
    // Mutate the live run coverage after generation.
    store.seed({
      id: 'run-1',
      orgId,
      projectId,
      coverage: emptyResearchRunCoverage(),
    });
    expect(created.coverageSnapshot).toEqual(coverage);
    expect(created.coverageSnapshot).not.toEqual(emptyResearchRunCoverage());
  });
});
