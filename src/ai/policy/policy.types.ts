import type { AiCapability } from '../capability';
import { EMBED_DIMENSION } from './embed-policy.constants';

export type PolicyProvider = 'voyage' | 'openai';

export interface PolicyDecision {
  readonly capability: AiCapability;
  readonly provider: PolicyProvider;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly embedModelVersion?: string;
  readonly dimension?: typeof EMBED_DIMENSION;
  readonly inputType?: import('./embed-policy.constants').EmbedInputType;
}
