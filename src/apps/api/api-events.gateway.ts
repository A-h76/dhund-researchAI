import { Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, type Socket } from 'socket.io';
import { isUuid } from '../../platform/ids/uuid-v7';
import { decideCors } from '../../platform/http/cors-policy';
import { getAppConfig } from '../../platform/config/config.runtime';
import { MetricsSurface } from '../../platform/observability/metrics-surface';

@WebSocketGateway({
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const allowed =
        decideCors(origin, getAppConfig().corsAllowedOrigins) !== 'reject';
      callback(null, allowed);
    },
    credentials: true,
  },
})
export class ApiEventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(@Optional() private readonly metrics?: MetricsSurface) {}

  handleConnection(): void {
    this.metrics?.recordWsConnection(1);
  }

  handleDisconnect(): void {
    this.metrics?.recordWsConnection(-1);
  }

  @SubscribeMessage('room:join')
  join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): { readonly joined: boolean } {
    const room = conversationRoom(body);
    if (room === null) {
      this.metrics?.recordWsJoinDenial();
      return { joined: false };
    }
    void client.join(room);
    return { joined: true };
  }
}

function conversationRoom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const conversationId = (body as { conversationId?: unknown }).conversationId;
  if (typeof conversationId !== 'string' || !isUuid(conversationId)) {
    return null;
  }
  return `conversation:${conversationId}`;
}
