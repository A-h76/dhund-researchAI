import { Module } from '@nestjs/common';
import { OBJECT_STORAGE_SERVICE } from './object-storage.port';
import { StubObjectStorageService } from './stub-object-storage.service';

@Module({
  providers: [
    {
      provide: OBJECT_STORAGE_SERVICE,
      useClass: StubObjectStorageService,
    },
  ],
  exports: [OBJECT_STORAGE_SERVICE],
})
export class ObjectStorageModule {}
