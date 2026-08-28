import { Injectable } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.port';

@Injectable()
export class StubObjectStorageService implements ObjectStorageService {
  async ping(): Promise<boolean> {
    return true;
  }
}
