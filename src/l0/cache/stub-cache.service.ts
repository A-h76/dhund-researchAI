import { Injectable } from '@nestjs/common';
import { CacheService } from './cache.port';

@Injectable()
export class StubCacheService implements CacheService {
  async ping(): Promise<boolean> {
    return true;
  }
}
