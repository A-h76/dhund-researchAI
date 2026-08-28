import { Injectable } from '@nestjs/common';
import { EmailService } from './email.port';

@Injectable()
export class StubEmailService implements EmailService {
  async ping(): Promise<boolean> {
    return true;
  }
}
