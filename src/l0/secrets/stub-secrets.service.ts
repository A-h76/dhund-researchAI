import { Injectable } from '@nestjs/common';
import { SecretsService } from './secrets.port';

@Injectable()
export class StubSecretsService implements SecretsService {
  async ping(): Promise<boolean> {
    return true;
  }
}
