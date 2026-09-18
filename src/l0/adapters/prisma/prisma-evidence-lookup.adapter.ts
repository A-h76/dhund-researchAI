import { Injectable } from '@nestjs/common';
import { L0OperationError } from '../../ports/errors';
import type {
  EvidenceLookup,
  EvidenceLookupResult,
  EvidenceLookupRow,
  EvidenceStanceValue,
  EvidenceTypeValue,
  SourceLookupRow,
} from '../../ports/evidence-lookup.port';
import type { ProjectScope } from '../../ports/scoped-store.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

const STANCES: ReadonlySet<string> = new Set([
  'supports',
  'contradicts',
  'neutral',
  'unresolved',
]);

const TYPES: ReadonlySet<string> = new Set(['body_grounded', 'metadata_only']);

@Injectable()
export class PrismaEvidenceLookupAdapter implements EvidenceLookup {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async lookup(
    scope: ProjectScope,
    chunkIds: readonly string[],
    documentIds: readonly string[],
  ): Promise<EvidenceLookupResult> {
    if (chunkIds.length === 0 && documentIds.length === 0) {
      return { evidence: [], sources: [] };
    }
    await this.database.connect();
    try {
      const client = this.database.getPrismaClient();
      const [evidenceRows, sourceRows] = await Promise.all([
        chunkIds.length === 0
          ? Promise.resolve([])
          : client.evidence.findMany({
              where: {
                projectId: scope.projectId,
                chunkId: { in: [...chunkIds] },
                supersededById: null,
              },
              select: {
                id: true,
                chunkId: true,
                sourceId: true,
                stance: true,
                qualityScore: true,
                type: true,
              },
            }),
        documentIds.length === 0
          ? Promise.resolve([])
          : client.source.findMany({
              where: {
                projectId: scope.projectId,
                documentId: { in: [...documentIds] },
              },
              select: { id: true, documentId: true },
            }),
      ]);
      return {
        evidence: evidenceRows.flatMap((row) => {
          const mapped = toEvidenceRow(row);
          return mapped === null ? [] : [mapped];
        }),
        sources: sourceRows.flatMap((row) => {
          const mapped = toSourceRow(row);
          return mapped === null ? [] : [mapped];
        }),
      };
    } catch (error) {
      throw new L0OperationError('Evidence lookup failed', error);
    }
  }
}

function toEvidenceRow(row: {
  readonly id: string;
  readonly chunkId: string | null;
  readonly sourceId: string;
  readonly stance: string;
  readonly qualityScore: { toNumber?: () => number } | number | string;
  readonly type: string;
}): EvidenceLookupRow | null {
  if (row.chunkId === null || !isStance(row.stance) || !isType(row.type)) {
    return null;
  }
  return {
    id: row.id,
    chunkId: row.chunkId,
    sourceId: row.sourceId,
    stance: row.stance,
    qualityScore: toScore(row.qualityScore),
    type: row.type,
  };
}

function toSourceRow(row: {
  readonly id: string;
  readonly documentId: string | null;
}): SourceLookupRow | null {
  if (row.documentId === null) {
    return null;
  }
  return { id: row.id, documentId: row.documentId };
}

function toScore(value: { toNumber?: () => number } | number | string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  if (typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return Number(value);
}

function isStance(value: string): value is EvidenceStanceValue {
  return STANCES.has(value);
}

function isType(value: string): value is EvidenceTypeValue {
  return TYPES.has(value);
}
