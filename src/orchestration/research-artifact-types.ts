import type { ResearchRunPresetName } from '../l0/ports';

/**
 * Artifact types enqueued after a run reaches COMPLETED / COMPLETED_PARTIAL.
 * Chat is interactive (GAP-INTERACTIVE-STREAM-01) and does not generate research artifacts.
 */
export const RESEARCH_ARTIFACT_TYPES = [
  'extraction_matrix',
  'deep_research_report',
  'synthesis',
  'consensus',
] as const;

export type ResearchArtifactTypeName = (typeof RESEARCH_ARTIFACT_TYPES)[number];

export function isResearchArtifactType(value: string): value is ResearchArtifactTypeName {
  return (RESEARCH_ARTIFACT_TYPES as readonly string[]).includes(value);
}

export function artifactTypesForPreset(
  preset: ResearchRunPresetName,
): readonly ResearchArtifactTypeName[] {
  switch (preset) {
    case 'deep_research':
      return ['deep_research_report'];
    case 'extraction_matrix':
      return ['extraction_matrix'];
    case 'custom':
      return ['synthesis'];
    case 'chat':
      return [];
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}
