import { Inject, Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { APP_CONFIG, type FrozenAppConfig } from '../../platform/config';
import type { PasswordHasher } from './password-hasher';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(@Inject(APP_CONFIG) private readonly config: FrozenAppConfig) {}

  async hash(password: string): Promise<string> {
    const { memoryCost, timeCost, parallelism } = this.config.argon2;
    return hash(password, {
      type: argon2id,
      memoryCost,
      timeCost,
      parallelism,
    });
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    try {
      return await verify(encodedHash, password);
    } catch {
      return false;
    }
  }
}
