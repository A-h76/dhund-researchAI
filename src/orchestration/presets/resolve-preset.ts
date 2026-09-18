import type { ResearchRunFailedReason, ResearchRunPresetName } from '../../l0/ports';
import { CHAT_V1, DEEP_RESEARCH_V1, EXTRACTION_MATRIX_V1 } from './builtin-presets';
import {
  fingerprintResearchRunStep,
  parseResearchRunDag,
  RESEARCH_RUN_STEP_VERSION,
  ResearchRunDagError,
  type ResearchRunDag,
} from './research-run-dag';

export type ResolvePresetResult =
  | { readonly kind: 'ok'; readonly dag: ResearchRunDag }
  | { readonly kind: 'failed'; readonly reason: ResearchRunFailedReason };

/**
 * GAP-PRESET-01: built-in presets resolve from versioned code, never a table.
 * `custom` reads the DAG persisted on the run.
 */
export function resolveResearchRunPreset(input: {
  readonly preset: ResearchRunPresetName;
  readonly customDag: unknown | null;
}): ResolvePresetResult {
  switch (input.preset) {
    case 'deep_research':
      if (input.customDag !== null) {
        return { kind: 'failed', reason: 'planning_failure' };
      }
      return { kind: 'ok', dag: DEEP_RESEARCH_V1 };
    case 'extraction_matrix':
      if (input.customDag !== null) {
        return { kind: 'failed', reason: 'planning_failure' };
      }
      return { kind: 'ok', dag: EXTRACTION_MATRIX_V1 };
    case 'chat':
      if (input.customDag !== null) {
        return { kind: 'failed', reason: 'planning_failure' };
      }
      return { kind: 'ok', dag: CHAT_V1 };
    case 'custom':
      if (input.customDag === null) {
        return { kind: 'failed', reason: 'planning_failure' };
      }
      try {
        return { kind: 'ok', dag: parseResearchRunDag(input.customDag) };
      } catch (error) {
        if (error instanceof ResearchRunDagError) {
          return { kind: 'failed', reason: 'planning_failure' };
        }
        throw error;
      }
    default: {
      const _exhaustive: never = input.preset;
      return _exhaustive;
    }
  }
}

export function findDagNode(
  dag: ResearchRunDag,
  input: { readonly runId: string; readonly stepType: string; readonly inputFingerprint: string },
): ResearchRunDag['nodes'][number] | null {
  const matches = dag.nodes.filter((node) => node.stepType === input.stepType);
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  return (
    matches.find((node) => {
      const fingerprint = fingerprintResearchRunStep({
        runId: input.runId,
        key: node.key,
        stepType: node.stepType,
        stepVersion: RESEARCH_RUN_STEP_VERSION,
      });
      return fingerprint === input.inputFingerprint;
    }) ?? null
  );
}
