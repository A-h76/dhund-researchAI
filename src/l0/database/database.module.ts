import { Module } from '@nestjs/common';
import { DATABASE_SERVICE } from './database.port';
import { StubDatabaseService } from './stub-database.service';

@Module({
  providers: [
    {
      provide: DATABASE_SERVICE,
      useClass: StubDatabaseService,
    },
  ],
  exports: [DATABASE_SERVICE],
})
export class DatabaseModule {}
