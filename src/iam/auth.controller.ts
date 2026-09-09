import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { AuthService, type TokenPairResponse } from './auth/auth.service';
import { AuthTokensService, type AuthAcceptedResponse } from './auth/auth-tokens.service';
import {
  MfaService,
  type RecoveryCodesResponse,
  type TotpEnrolResponse,
} from './auth/mfa.service';
import {
  RegistrationService,
  type RegisterResponse,
} from './registration/registration.service';
import type { JwksResponse } from './tokens/access-token.service';
import {
  attachAuthCookies,
  clearAuthCookies,
  generateCsrfToken,
  type HeaderAppendResponse,
} from '../platform/http';
import { RequireAuth } from './authorization/require-auth';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly auth: AuthService,
    private readonly tokens: AuthTokensService,
    private readonly mfa: MfaService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() body: unknown): Promise<RegisterResponse> {
    return this.registration.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: HeaderAppendResponse,
  ): Promise<TokenPairResponse> {
    return withCookies(res, await this.auth.login(body));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: unknown,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) res: HeaderAppendResponse,
  ): Promise<TokenPairResponse> {
    return withCookies(res, await this.auth.refresh(body, cookie));
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAuth()
  async logoutAll(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: HeaderAppendResponse,
  ): Promise<void> {
    await this.auth.logoutAll(authorization);
    clearAuthCookies(res);
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

  @Post('mfa/totp/enrol')
  @HttpCode(HttpStatus.OK)
  @RequireAuth()
  enrolTotp(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<TotpEnrolResponse> {
    return this.mfa.enrol(authorization);
  }

  @Post('mfa/totp/confirm')
  @HttpCode(HttpStatus.OK)
  @RequireAuth()
  confirmTotp(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<RecoveryCodesResponse> {
    return this.mfa.confirm(authorization, body);
  }

  @Post('mfa/totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAuth()
  disableTotp(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    return this.mfa.disable(authorization, body);
  }

  @Post('mfa/recovery/issue')
  @HttpCode(HttpStatus.OK)
  @RequireAuth()
  issueRecovery(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<RecoveryCodesResponse> {
    return this.mfa.issueRecovery(authorization, body);
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: HeaderAppendResponse,
  ): Promise<TokenPairResponse> {
    return withCookies(res, await this.mfa.verify(body));
  }
}

function withCookies(
  res: HeaderAppendResponse,
  pair: TokenPairResponse,
): TokenPairResponse {
  attachAuthCookies(res, pair.refreshToken, generateCsrfToken());
  return pair;
}
