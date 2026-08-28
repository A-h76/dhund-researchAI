export interface AppliedMigrationRecord {
  readonly migrationName: string;
  readonly finishedAt: Date | null;
  readonly rolledBackAt: Date | null;
}

export interface DatabaseService {
  connect(correlationId?: string): Promise<void>;
  disconnect(correlationId?: string): Promise<void>;
  ping(): Promise<boolean>;
  listAppliedMigrations(): Promise<readonly AppliedMigrationRecord[]>;
}
