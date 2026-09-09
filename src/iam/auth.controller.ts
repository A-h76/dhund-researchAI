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
}
