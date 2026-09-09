export const BACKUP_RETENTION_DAYS = 30;
export const BACKUP_RETENTION_MS =
  BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface TombstonedProject {
  readonly id: string;
  readonly orgId: string;
  readonly deletedAt: Date;
}

export interface ProjectErasureStore {
  findTombstonedProject(projectId: string): Promise<TombstonedProject | null>;
  stampOwnedDeletedAt(projectId: string): Promise<number>;
  listStorageKeys(projectId: string): Promise<readonly string[]>;
  anonymiseAuditActors(projectId: string): Promise<number>;
}

export function backupTailEndsAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + BACKUP_RETENTION_MS);
}

export function isErasureComplete(
  deletedAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() >= backupTailEndsAt(deletedAt).getTime();
}
