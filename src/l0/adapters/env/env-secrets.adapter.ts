import { Injectable } from '@nestjs/common';
import type { SecretsService } from '../../ports/secrets.port';

@Injectable()
export class EnvSecretsAdapter implements SecretsService {
  getSecret(name: string): string | undefined {
    const value = process.env[name];
    return value && value.length > 0 ? value : undefined;
  }
}
