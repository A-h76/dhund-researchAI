import { aggregateResearchRunStepOutcomes } from '../../src/l0/ports/research-run-step-outcomes';
import {
  emptyResearchRunCoverage,
  parseResearchRunCoverage,
} from '../../src/l0/ports/research-run-coverage';
import { BUILTIN_PRESETS, DEEP_RESEARCH_V1 } from '../../src/orchestration/presets/builtin-presets';
import {
  dagDepth,
  parseResearchRunDag,
  ResearchRunDagError,
} from '../../src/orchestration/presets/research-run-dag';
import { resolveResearchRunPreset } from '../../src/orchestration/presets/resolve-preset';

describe('GAP-PRESET-01 code-resolved presets (DHB-65)', () => {
  it('resolves built-in presets from versioned code with no DB read', () => {
    expect(resolveResearchRunPreset({ preset: 'deep_research', customDag: null })).toEqual({
      kind: 'ok',
      dag: DEEP_RESEARCH_V1,
    });
    expect(resolveResearchRunPreset({ preset: 'extraction_matrix', customDag: null }).kind).toBe(
      'ok',
    );
    expect(resolveResearchRunPreset({ preset: 'chat', customDag: null }).kind).toBe('ok');
    expect(BUILTIN_PRESETS.DEEP_RESEARCH_V1.presetCode).toBe('DEEP_RESEARCH_V1');
  });

  it('persists custom DAG on the run and rejects a missing or cyclic DAG', () => {
    const dag = {
      schemaVersion: 1 as const,
      presetCode: 'custom',
      nodes: [
        { key: 'retrieve', stepType: 'retrieve' as const, dependsOn: [] as const, query: 'q' },
        { key: 'admit', stepType: 'admit' as const, dependsOn: ['retrieve'] as const },
      ],
    };
    const resolved = resolveResearchRunPreset({ preset: 'custom', customDag: dag });
    expect(resolved.kind).toBe('ok');
    if (resolved.kind === 'ok') {
      expect(resolved.dag.nodes.map((node) => node.key)).toEqual(['retrieve', 'admit']);
      expect(dagDepth(resolved.dag)).toBe(2);
    }

    expect(resolveResearchRunPreset({ preset: 'custom', customDag: null })).toEqual({
      kind: 'failed',
      reason: 'planning_failure',
    });
    expect(resolveResearchRunPreset({ preset: 'deep_research', customDag: dag })).toEqual({
      kind: 'failed',
      reason: 'planning_failure',
    });
    expect(() =>
      parseResearchRunDag({
        schemaVersion: 1,
        presetCode: 'custom',
        nodes: [
          { key: 'a', stepType: 'retrieve', dependsOn: ['b'] },
          { key: 'b', stepType: 'admit', dependsOn: ['a'] },
        ],
      }),
    ).toThrow(ResearchRunDagError);
  });
});

describe('GAP-COVERAGE-01 stepOutcomes stay outside coverage (DHB-65)', () => {
  it('rejects stepOutcomes nested in the coverage object', () => {
    expect(() =>
      parseResearchRunCoverage({
        ...emptyResearchRunCoverage(),
        stepOutcomes: { succeeded: 1, failed: 0, skipped: 0, cancelled: 0 },
      }),
    ).toThrow(/stepOutcomes must not appear inside coverage/);
  });

  it('rejects retired Funnel-B counters inside processing', () => {
    expect(() =>
      parseResearchRunCoverage({
        schemaVersion: 1,
        discovery: emptyResearchRunCoverage().discovery,
        processing: {
          ...emptyResearchRunCoverage().processing,
          succeeded: 1,
        },
      }),
    ).toThrow(/succeeded/);
  });
});

describe('Phase 7 ResearchRunStep DEFERRED outcome (DHB-65)', () => {
  it('counts DEFERRED as skipped, not failed', () => {
    expect(
      aggregateResearchRunStepOutcomes({
        ready: 0,
        inFlight: 0,
        pending: 0,
        deferred: 11,
        succeeded: 61,
        failed: 2,
        cancelled: 0,
      }),
    ).toEqual({
      succeeded: 61,
      failed: 2,
      skipped: 11,
      cancelled: 0,
    });
  });
});
