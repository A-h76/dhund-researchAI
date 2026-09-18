import type { RuntimeRole } from '../platform/runtime/role';

export const CHAT_GATEWAY = Symbol('CHAT_GATEWAY');

export interface ChatGatewayInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly correlationId: string;
  readonly runtimeRole: RuntimeRole;
  readonly userMessage: string;
  readonly documentContent: string;
  readonly retrievalFingerprint: string;
  readonly retrievalTraceId: string;
  readonly onToken?: (token: string) => void;
}

export interface ChatGatewayResult {
  readonly text: string;
  readonly aiExecutionId: string;
  readonly inputFingerprint: string;
  readonly method: 'llm' | 'deterministic';
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMicros: number;
  readonly latencyMs: number;
}

/**
 * Interactive Paper Chat generation. Implementation lives in AI and must call
 * Gateway CHAT on the interactive lane — orchestration never imports a provider
 * SDK or creates a BullMQ job.
 */
export interface ChatGatewayPort {
  chat(input: ChatGatewayInput): Promise<ChatGatewayResult>;
}
