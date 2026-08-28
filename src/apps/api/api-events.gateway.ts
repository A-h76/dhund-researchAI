import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: true })
export class ApiEventsGateway {
  @WebSocketServer()
  server!: Server;
}
