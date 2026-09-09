import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService, type TokenPairResponse } from './auth/auth.service';
import { AuthTokensService, type AuthAcceptedResponse } from './auth/auth-tokens.service';
import {
  RegistrationService,
  type RegisterResponse,
} from './registration/registration.service';
import type { JwksResponse } from './tokens/access-token.service';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly auth: AuthService,
    private readonly tokens: AuthTokensService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() body: unknown): Promise<RegisterResponse> {
    return this.registration.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: unknown): Promise<TokenPairResponse> {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: unknown): Promise<TokenPairResponse> {
    return this.auth.refresh(body);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    return this.auth.logoutAll(authorization);
  }

  @Get('jwks')
  jwks(): Promise<JwksResponse> {
    return this.auth.jwks();
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() body: unknown): Promise<void> {
    return this.tokens.verifyEmail(body);
  }

  @Post('verify-email/resend')
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() body: unknown): Promise<AuthAcceptedResponse> {
    return this.tokens.resendVerification(body);
  }

  @Post('password/reset-request')
  @HttpCode(HttpStatus.OK)
  requestPasswordReset(@Body() body: unknown): Promise<AuthAcceptedResponse> {
    return this.tokens.requestPasswordReset(body);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() body: unknown): Promise<void> {
    return this.tokens.resetPassword(body);
  }
}
