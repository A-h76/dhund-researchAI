import { Injectable } from '@nestjs/common';
import { QueueService } from './queue.port';

@Injectable()
export class StubQueueService implements QueueService {
  async ping(): Promise<boolean> {
    return true;
  }
}
