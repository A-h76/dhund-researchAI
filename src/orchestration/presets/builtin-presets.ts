import type { ResearchRunDag } from './research-run-dag';

/** Default query for Deep Research retrieval entry (review-gated, versioned). */
export const DEEP_RESEARCH_QUERY = 'deep research';

export const DEEP_RESEARCH_V1: ResearchRunDag = {
  schemaVersion: 1,
  presetCode: 'DEEP_RESEARCH_V1',
  nodes: [
    {
      key: 'retrieve',
      stepType: 'retrieve',
      dependsOn: [],
      query: DEEP_RESEARCH_QUERY,
    },
    {
      key: 'admit',
      stepType: 'admit',
      dependsOn: ['retrieve'],
    },
  ],
};

export const EXTRACTION_MATRIX_V1: ResearchRunDag = {
  schemaVersion: 1,
  presetCode: 'EXTRACTION_MATRIX_V1',
  nodes: [
    {
      key: 'admit',
      stepType: 'admit',
      dependsOn: [],
    },
  ],
};

export const CHAT_V1: ResearchRunDag = {
  schemaVersion: 1,
  presetCode: 'CHAT_V1',
  nodes: [
    {
      key: 'retrieve',
      stepType: 'retrieve',
      dependsOn: [],
      query: 'chat',
    },
  ],
};

export const BUILTIN_PRESETS: Readonly<Record<string, ResearchRunDag>> = {
  DEEP_RESEARCH_V1,
  EXTRACTION_MATRIX_V1,
  CHAT_V1,
};
