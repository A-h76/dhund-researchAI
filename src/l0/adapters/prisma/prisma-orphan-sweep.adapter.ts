import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type {
  LiveDocumentRecord,
  NewDocumentVersionInput,
  OrphanSweepStore,
  OwnedStorageKeysResult,
} from '../../ports/orphan-sweep-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

const OWNED_KEYS_TIMEOUT_MS = 15_000;

@Injectable()
export class PrismaOrphanSweepAdapter implements OrphanSweepStore {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findLiveById(id: string): Promise<LiveDocumentRecord | null> {
    await this.database.connect();
    try {
      const row = await this.client().document.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          projectId: true,
          orgId: true,
          status: true,
          storageKey: true,
        },
      });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        projectId: row.projectId,
        orgId: row.orgId,
        status: row.status,
        storageKey: row.storageKey,
      };
    } catch (error) {
      throw new L0OperationError('Document lookup failed', error);
    }
  }

  async listOwnedStorageKeys(): Promise<OwnedStorageKeysResult> {
    await this.database.connect();
    try {
      const keys = await withTimeout(loadOwnedKeys(this.client()), OWNED_KEYS_TIMEOUT_MS);
      return { ok: true, keys };
    } catch {
      return { ok: false };
    }
  }

  async retireVersion(versionId: string): Promise<boolean> {
    await this.database.connect();
    try {
      const updated = await this.client().documentVersion.updateMany({
        where: { id: versionId, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      return updated.count === 1;
    } catch (error) {
      throw new L0OperationError('Version retire failed', error);
    }
  }

  async addVersion(input: NewDocumentVersionInput): Promise<void> {
    await this.database.connect();
    try {
      await this.client().documentVersion.create({
        data: {
          id: input.id,
          documentId: input.documentId,
          versionNo: input.versionNo,
          storageKey: input.storageKey,
        },
      });
    } catch (error) {
      throw new L0OperationError('Document version insert failed', error);
    }
  }

  async countChunksForDocument(documentId: string): Promise<number> {
    await this.database.connect();
    try {
      return await this.client().chunk.count({
        where: { documentVersion: { documentId } },
      });
    } catch (error) {
      throw new L0OperationError('Chunk count failed', error);
    }
  }

  async countEmbeddingsForDocument(documentId: string): Promise<number> {
    await this.database.connect();
    try {
      return await this.client().chunkEmbedding.count({
        where: { chunk: { documentVersion: { documentId } } },
      });
    } catch (error) {
      throw new L0OperationError('Embedding count failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }
}

async function loadOwnedKeys(
  client: ReturnType<PrismaDatabaseAdapter['getPrismaClient']>,
): Promise<Set<string>> {
  const [documents, versions, sessions] = await Promise.all([
    client.document.findMany({
      where: { deletedAt: null },
      select: { storageKey: true },
    }),
    client.documentVersion.findMany({
      where: { document: { deletedAt: null } },
      select: { storageKey: true },
    }),
    client.uploadSession.findMany({
      where: {
        status: { in: ['issued', 'uploaded'] },
        expiresAt: { gt: new Date() },
      },
      select: { storageKey: true },
    }),
  ]);
  const keys = new Set<string>();
  for (const row of documents) {
    keys.add(row.storageKey);
  }
  for (const row of versions) {
    keys.add(row.storageKey);
  }
  for (const row of sessions) {
    keys.add(row.storageKey);
  }
  return keys;
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('owned-keys timeout'));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
