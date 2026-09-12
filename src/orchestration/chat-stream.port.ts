export const CHAT_STREAM_SINK = Symbol('CHAT_STREAM_SINK');

export interface MessageTokenEvent {
  readonly conversationId: string;
  readonly messageId: string;
  readonly sequence: number;
  readonly token: string;
}

export interface MessageCompleteEvent {
  readonly conversationId: string;
  readonly messageId: string;
  readonly sequence: number;
  readonly content: string;
  readonly aiExecutionId: string;
  readonly evidenceIds: readonly string[];
  readonly retrievalTraceId: string;
  readonly retrievalFingerprint: string;
}

/**
 * Optional live sink for Paper Chat tokens. Implementations must swallow
 * disconnect errors so generation is never cancelled by the socket closing.
 */
export interface ChatStreamSink {
  emitToken(event: MessageTokenEvent): void;
  emitComplete(event: MessageCompleteEvent): void;
}

export class NoopChatStreamSink implements ChatStreamSink {
  emitToken(_event: MessageTokenEvent): void {}
  emitComplete(_event: MessageCompleteEvent): void {}
}
