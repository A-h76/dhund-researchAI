import { Module } from '@nestjs/common';
import { BREACH_LIST } from '../l0/ports';
import { PlatformModule } from '../platform/platform.module';
import { AuthRegisterController } from './auth-register.controller';
import { Argon2PasswordHasher } from './password/argon2-hasher';
import { PASSWORD_BREACH_LIST } from './password/breach-list.port';
import { PASSWORD_HASHER } from './password/password-hasher';
import { PasswordPolicy } from './password/password-policy';
import { RegistrationMetrics } from './registration/registration.metrics';
import { RegistrationService } from './registration/registration.service';

@Module({
  imports: [PlatformModule],
  controllers: [AuthRegisterController],
  providers: [
    Argon2PasswordHasher,
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    { provide: PASSWORD_BREACH_LIST, useExisting: BREACH_LIST },
    PasswordPolicy,
    RegistrationMetrics,
    RegistrationService,
  ],
})
export class IamModule {}
