import { Global, Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { ChatGatewayAdapter } from '../../ai/chat/chat-gateway.adapter';
import { CHAT_GATEWAY } from '../../orchestration/chat-gateway.port';
import { CHAT_STREAM_SINK } from '../../orchestration/chat-stream.port';
import { ApiEventsGateway } from './api-events.gateway';
import { SocketChatStreamSink } from './socket-chat-stream.sink';

@Global()
@Module({
  imports: [AiModule],
  providers: [
    ApiEventsGateway,
    SocketChatStreamSink,
    { provide: CHAT_STREAM_SINK, useExisting: SocketChatStreamSink },
    { provide: CHAT_GATEWAY, useExisting: ChatGatewayAdapter },
  ],
  exports: [
    ApiEventsGateway,
    CHAT_STREAM_SINK,
    SocketChatStreamSink,
    CHAT_GATEWAY,
  ],
})
export class ApiRealtimeModule {}
