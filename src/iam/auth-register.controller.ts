import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  RegistrationService,
  type RegisterResponse,
} from './registration/registration.service';

@Controller('v1/auth')
export class AuthRegisterController {
  constructor(private readonly registration: RegistrationService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() body: unknown): Promise<RegisterResponse> {
    return this.registration.register(body);
  }
}
