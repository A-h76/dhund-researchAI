import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.port';

@Injectable()
export class StubDatabaseService implements DatabaseService {
  async ping(): Promise<boolean> {
    return true;
  }
}
