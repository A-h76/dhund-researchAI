import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '../../l0/ports';
import {
  evaluateMigrationReadiness,
  listExpectedMigrationNames,
} from './migration-readiness.util';

@Injectable()
export class MigrationReadinessService {
  private readonly migrationsRoot = join(process.cwd(), 'prisma', 'migrations');

  constructor(
    @Inject(DATABASE_SERVICE) private readonly database: DatabaseService,
  ) {}

  async isReady(): Promise<boolean> {
    const expected = listExpectedMigrationNames(this.migrationsRoot);
    const applied = await this.database.listAppliedMigrations();
    return evaluateMigrationReadiness(expected, applied);
  }
}
