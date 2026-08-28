import { Module } from '@nestjs/common';
import { CacheModule } from './cache/cache.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { ObjectStorageModule } from './object-storage/object-storage.module';
import { QueueModule } from './queue/queue.module';
import { SecretsModule } from './secrets/secrets.module';

@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    QueueModule,
    ObjectStorageModule,
    SecretsModule,
    EmailModule,
  ],
  exports: [
    DatabaseModule,
    CacheModule,
    QueueModule,
    ObjectStorageModule,
    SecretsModule,
    EmailModule,
  ],
})
export class L0Module {}
