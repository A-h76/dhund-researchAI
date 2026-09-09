import type {
  ProjectErasureStore,
  TombstonedProject,
} from '../../src/l0/ports/project-erasure.port';

export class MemoryProjectErasureStore implements ProjectErasureStore {
  tombstone: TombstonedProject | null = null;
  storageKeys: string[] = [];
  ownedStampCount = 0;
  actorUpdates = 0;
  anonymiseCalls = 0;
  stampCalls = 0;

  async findTombstonedProject(
    projectId: string,
  ): Promise<TombstonedProject | null> {
    if (this.tombstone === null || this.tombstone.id !== projectId) {
      return null;
    }
    return this.tombstone;
  }

  async stampOwnedDeletedAt(_projectId: string): Promise<number> {
    this.stampCalls += 1;
    return this.ownedStampCount;
  }

  async listStorageKeys(_projectId: string): Promise<readonly string[]> {
    return [...this.storageKeys];
  }

  async anonymiseAuditActors(_projectId: string): Promise<number> {
    this.anonymiseCalls += 1;
    const count = this.actorUpdates;
    this.actorUpdates = 0;
    return count;
  }
}
