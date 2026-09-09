import { Module } from '@nestjs/common';
import { BREACH_LIST } from '../l0/ports';
import { PlatformModule } from '../platform/platform.module';
import { AuthController } from './auth.controller';
import { AuthMetrics } from './auth/auth.metrics';
import { AuthService } from './auth/auth.service';
import { AuthTokenMetrics } from './auth/auth-token.metrics';
import { AuthTokensService } from './auth/auth-tokens.service';
import { Argon2PasswordHasher } from './password/argon2-hasher';
import { PASSWORD_BREACH_LIST } from './password/breach-list.port';
import { PASSWORD_HASHER } from './password/password-hasher';
import { PasswordPolicy } from './password/password-policy';
import { RegistrationMetrics } from './registration/registration.metrics';
import { RegistrationService } from './registration/registration.service';
import { AccessTokenService } from './tokens/access-token.service';
import { AuthTokenService } from './tokens/auth-token.service';

@Module({
  imports: [PlatformModule],
  controllers: [AuthController],
  providers: [
    Argon2PasswordHasher,
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    { provide: PASSWORD_BREACH_LIST, useExisting: BREACH_LIST },
    PasswordPolicy,
    RegistrationMetrics,
    RegistrationService,
    AuthMetrics,
    AuthTokenMetrics,
    AccessTokenService,
    AuthTokenService,
    AuthService,
    AuthTokensService,
  ],
})
export class IamModule {}
