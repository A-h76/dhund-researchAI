import { Module } from '@nestjs/common';
import { SECRETS_SERVICE } from './secrets.port';
import { StubSecretsService } from './stub-secrets.service';

@Module({
  providers: [
    {
      provide: SECRETS_SERVICE,
      useClass: StubSecretsService,
    },
  ],
  exports: [SECRETS_SERVICE],
})
export class SecretsModule {}
