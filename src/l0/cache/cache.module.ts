import { Module } from '@nestjs/common';
import { CACHE_SERVICE } from './cache.port';
import { StubCacheService } from './stub-cache.service';

@Module({
  providers: [
    {
      provide: CACHE_SERVICE,
      useClass: StubCacheService,
    },
  ],
  exports: [CACHE_SERVICE],
})
export class CacheModule {}
