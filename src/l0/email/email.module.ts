import { Module } from '@nestjs/common';
import { EMAIL_SERVICE } from './email.port';
import { StubEmailService } from './stub-email.service';

@Module({
  providers: [
    {
      provide: EMAIL_SERVICE,
      useClass: StubEmailService,
    },
  ],
  exports: [EMAIL_SERVICE],
})
export class EmailModule {}
