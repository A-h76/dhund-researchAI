import type { RuntimeRole } from '../platform/runtime/role';

export const QUERY_EMBED = Symbol('QUERY_EMBED');

export interface QueryEmbedInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly text: string;
  readonly correlationId: string;
  readonly runtimeRole: RuntimeRole;
}

/**
 * Query-side embedding only. The implementation lives in AI and must call
 * Gateway EMBED with input_type=query — retrieval never imports a provider SDK.
 */
export interface QueryEmbedPort {
  embedQuery(input: QueryEmbedInput): Promise<string>;
}
