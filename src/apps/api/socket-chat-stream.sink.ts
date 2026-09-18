import { Injectable } from '@nestjs/common';
import { ApiEventsGateway } from './api-events.gateway';
import type {
  ChatStreamSink,
  MessageCompleteEvent,
  MessageTokenEvent,
} from '../../orchestration/chat-stream.port';

export const MESSAGE_TOKEN_EVENT = 'message:token';
export const MESSAGE_COMPLETE_EVENT = 'message:complete';

@Injectable()
export class SocketChatStreamSink implements ChatStreamSink {
  constructor(private readonly gateway: ApiEventsGateway) {}

  emitToken(event: MessageTokenEvent): void {
    this.safeEmit(MESSAGE_TOKEN_EVENT, event);
  }

  emitComplete(event: MessageCompleteEvent): void {
    this.safeEmit(MESSAGE_COMPLETE_EVENT, event);
  }

  private safeEmit(event: string, payload: MessageTokenEvent | MessageCompleteEvent): void {
    try {
      const server = this.gateway.server;
      if (server === undefined || server === null) {
        return;
      }
      const room = `conversation:${payload.conversationId}`;
      server.to(room).emit(event, payload);
    } catch {
      // Disconnect mid-stream must not cancel generation (DHB-62).
    }
  }
}
