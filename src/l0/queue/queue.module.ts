import { Module } from '@nestjs/common';
import { QUEUE_SERVICE } from './queue.port';
import { StubQueueService } from './stub-queue.service';

@Module({
  providers: [
    {
      provide: QUEUE_SERVICE,
      useClass: StubQueueService,
    },
  ],
  exports: [QUEUE_SERVICE],
})
export class QueueModule {}
