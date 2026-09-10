import { Injectable } from '@nestjs/common';
import { EvidenceStance, EvidenceType, ExtractionMethod, Prisma } from '@prisma/client';
import { L0OperationError } from '../../ports/errors';
import type {
  ArgumentClaimLinkRecord,
  ArgumentRecord,
  ChunkRecord,
  ClaimRecord,
  EvidenceClaimLinkRecord,
  EvidenceRecord,
  EvidenceSpinePort,
  ExtractionSetRecord,
  PersistExtractedEvidenceInput,
  SourceRecord,
  StanceLabelRecord,
  StoredEvidenceStance,
} from '../../ports/evidence-spine.port';
import { PrismaDatabaseAdapter } from './prisma-database.adapter';

const EXTRACTION_EVENT = 'evidence.extracted';
const STANCE_EVENT = 'stance.labelled';

@Injectable()
export class PrismaEvidenceSpineAdapter implements EvidenceSpinePort {
  constructor(private readonly database: PrismaDatabaseAdapter) {}

  async findSource(sourceId: string): Promise<SourceRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().source.findUnique({ where: { id: sourceId } });
      if (row === null) {
        return null;
      }
      return {
        id: row.id,
        projectId: row.projectId,
        documentId: row.documentId,
        type: row.type === 'document' ? 'document' : 'external_record',
      };
    } catch (error) {
      throw new L0OperationError('Source lookup failed', error);
    }
  }

  async findChunkInProject(chunkId: string, projectId: string): Promise<ChunkRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().chunk.findFirst({
        where: { id: chunkId, projectId },
      });
      return row === null ? null : toChunk(row);
    } catch (error) {
      throw new L0OperationError('Chunk lookup failed', error);
    }
  }

  async findChunkForBlock(input: {
    projectId: string;
    documentVersionId: string;
    blockId: string;
  }): Promise<ChunkRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().chunk.findFirst({
        where: {
          projectId: input.projectId,
          documentVersionId: input.documentVersionId,
          blockIds: { has: input.blockId },
        },
      });
      return row === null ? null : toChunk(row);
    } catch (error) {
      throw new L0OperationError('Chunk-for-block lookup failed', error);
    }
  }

  async findClaim(claimId: string, projectId: string): Promise<ClaimRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().claim.findFirst({
        where: { id: claimId, projectId, deletedAt: null },
      });
      if (row === null) {
        return null;
      }
      return toClaim(row);
    } catch (error) {
      throw new L0OperationError('Claim lookup failed', error);
    }
  }

  async createClaim(input: {
    id: string;
    projectId: string;
    text: string;
    coverageAnnotation: Readonly<Record<string, unknown>>;
  }): Promise<ClaimRecord> {
    await this.ensureConnected();
    try {
      const row = await this.client().claim.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          text: input.text,
          coverageAnnotation: input.coverageAnnotation as Prisma.InputJsonValue,
        },
      });
      return toClaim(row);
    } catch (error) {
      throw new L0OperationError('Claim create failed', error);
    }
  }

  async createArgument(input: {
    id: string;
    projectId: string;
    title: string;
    structure: unknown;
  }): Promise<ArgumentRecord> {
    await this.ensureConnected();
    try {
      const row = await this.client().argument.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          title: input.title,
          structure: input.structure as Prisma.InputJsonValue,
        },
      });
      return toArgument(row);
    } catch (error) {
      throw new L0OperationError('Argument create failed', error);
    }
  }

  async findArgument(argumentId: string, projectId: string): Promise<ArgumentRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().argument.findFirst({
        where: { id: argumentId, projectId },
      });
      return row === null ? null : toArgument(row);
    } catch (error) {
      throw new L0OperationError('Argument lookup failed', error);
    }
  }

  async countArgumentLinksForClaim(claimId: string): Promise<number> {
    await this.ensureConnected();
    try {
      return this.client().argumentClaimLink.count({ where: { claimId } });
    } catch (error) {
      throw new L0OperationError('Argument-link count failed', error);
    }
  }

  async countEvidenceLinksForClaim(claimId: string): Promise<number> {
    await this.ensureConnected();
    try {
      return this.client().evidenceClaimLink.count({ where: { claimId } });
    } catch (error) {
      throw new L0OperationError('Evidence-link count failed', error);
    }
  }

  async softDeleteClaim(claimId: string, projectId: string): Promise<boolean> {
    await this.ensureConnected();
    try {
      const result = await this.client().claim.updateMany({
        where: { id: claimId, projectId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return result.count > 0;
    } catch (error) {
      throw new L0OperationError('Claim delete failed', error);
    }
  }

  async linkArgumentClaim(input: {
    id: string;
    argumentId: string;
    claimId: string;
    projectId: string;
    role: string | null;
    ordinal: number | null;
  }): Promise<ArgumentClaimLinkRecord> {
    await this.ensureConnected();
    try {
      const row = await this.client().argumentClaimLink.create({
        data: {
          id: input.id,
          argumentId: input.argumentId,
          claimId: input.claimId,
          projectId: input.projectId,
          role: input.role,
          ordinal: input.ordinal,
        },
      });
      return {
        id: row.id,
        argumentId: row.argumentId,
        claimId: row.claimId,
        projectId: row.projectId,
        role: row.role,
        ordinal: row.ordinal,
      };
    } catch (error) {
      throw new L0OperationError('Argument-claim link create failed', error);
    }
  }

  async linkEvidenceClaim(input: {
    id: string;
    evidenceId: string;
    claimId: string;
    stance: StoredEvidenceStance;
    weight: string;
  }): Promise<EvidenceClaimLinkRecord> {
    await this.ensureConnected();
    try {
      const row = await this.client().evidenceClaimLink.create({
        data: {
          id: input.id,
          evidenceId: input.evidenceId,
          claimId: input.claimId,
          weight: new Prisma.Decimal(input.weight),
          stance: toPrismaStance(input.stance),
        },
      });
      return {
        id: row.id,
        evidenceId: row.evidenceId,
        claimId: row.claimId,
        stance: fromPrismaStance(row.stance),
      };
    } catch (error) {
      throw new L0OperationError('Evidence-claim link create failed', error);
    }
  }

  async listArgumentClaims(argumentId: string): Promise<readonly ArgumentClaimLinkRecord[]> {
    await this.ensureConnected();
    try {
      const rows = await this.client().argumentClaimLink.findMany({
        where: { argumentId },
        orderBy: [{ ordinal: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map((row) => ({
        id: row.id,
        argumentId: row.argumentId,
        claimId: row.claimId,
        projectId: row.projectId,
        role: row.role,
        ordinal: row.ordinal,
      }));
    } catch (error) {
      throw new L0OperationError('Argument-claim list failed', error);
    }
  }

  async listArgumentsForClaim(claimId: string): Promise<readonly ArgumentClaimLinkRecord[]> {
    await this.ensureConnected();
    try {
      const rows = await this.client().argumentClaimLink.findMany({
        where: { claimId },
      });
      return rows.map((row) => ({
        id: row.id,
        argumentId: row.argumentId,
        claimId: row.claimId,
        projectId: row.projectId,
        role: row.role,
        ordinal: row.ordinal,
      }));
    } catch (error) {
      throw new L0OperationError('Claim-argument list failed', error);
    }
  }

  async findEvidence(evidenceId: string, projectId: string): Promise<EvidenceRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().evidence.findFirst({
        where: { id: evidenceId, projectId },
      });
      return row === null ? null : toEvidence(row);
    } catch (error) {
      throw new L0OperationError('Evidence lookup failed', error);
    }
  }

  async listEvidenceForExecution(aiExecutionId: string): Promise<readonly EvidenceRecord[]> {
    await this.ensureConnected();
    try {
      const rows = await this.client().evidence.findMany({
        where: { aiExecutionId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toEvidence);
    } catch (error) {
      throw new L0OperationError('Evidence-by-execution lookup failed', error);
    }
  }

  async findExtractionSet(stepId: string): Promise<ExtractionSetRecord | null> {
    await this.ensureConnected();
    try {
      const row = await this.client().outbox.findFirst({
        where: { eventType: EXTRACTION_EVENT, aggregateId: stepId },
        orderBy: { createdAt: 'asc' },
      });
      if (row === null) {
        return null;
      }
      return parseExtractionSet(row.payload);
    } catch (error) {
      throw new L0OperationError('Extraction set lookup failed', error);
    }
  }

  async persistExtractionSet(input: {
    stepId: string;
    runId: string;
    inputFingerprint: string;
    correlationId: string;
    aiExecutionId: string;
    omittedLocatorCount: number;
    evidence: readonly PersistExtractedEvidenceInput[];
  }): Promise<ExtractionSetRecord> {
    await this.ensureConnected();
    try {
      const existing = await this.findExtractionSet(input.stepId);
      if (existing !== null) {
        return existing;
      }

      const evidenceIds = input.evidence.map((row) => row.id);
      const set: ExtractionSetRecord = {
        stepId: input.stepId,
        runId: input.runId,
        inputFingerprint: input.inputFingerprint,
        aiExecutionId: input.aiExecutionId,
        evidenceIds,
        omittedLocatorCount: input.omittedLocatorCount,
      };

      await this.client().$transaction(async (tx) => {
        for (const row of input.evidence) {
          await tx.evidence.create({
            data: {
              id: row.id,
              projectId: row.projectId,
              sourceId: row.sourceId,
              chunkId: row.chunkId,
              locator: row.locator as unknown as Prisma.InputJsonValue,
              text: row.text,
              stance: EvidenceStance.unresolved,
              qualityScore: new Prisma.Decimal('0.5'),
              extractionMethod: ExtractionMethod.llm,
              aiExecutionId: row.aiExecutionId,
              type:
                row.type === 'body_grounded'
                  ? EvidenceType.body_grounded
                  : EvidenceType.metadata_only,
            },
          });
        }

        await tx.outbox.create({
          data: {
            id: input.stepId,
            aggregateType: 'evidence_extraction',
            aggregateId: input.stepId,
            eventType: EXTRACTION_EVENT,
            schemaVersion: 1,
            payload: {
              stepId: input.stepId,
              runId: input.runId,
              inputFingerprint: input.inputFingerprint,
              aiExecutionId: input.aiExecutionId,
              evidenceIds,
              omittedLocatorCount: input.omittedLocatorCount,
            },
            correlationId: input.correlationId,
          },
        });

        await tx.researchRunStep.updateMany({
          where: { id: input.stepId },
          data: {
            state: 'SUCCEEDED',
            resultRef: input.aiExecutionId,
          },
        });
      });

      return set;
    } catch (error) {
      const raced = await this.findExtractionSet(input.stepId).catch(() => null);
      if (raced !== null) {
        return raced;
      }
      throw new L0OperationError('Evidence extraction persist failed', error);
    }
  }

  async findStanceLabel(runId: string, evidenceId: string): Promise<StanceLabelRecord | null> {
    await this.ensureConnected();
    try {
      const rows = await this.client().outbox.findMany({
        where: { eventType: STANCE_EVENT, aggregateId: evidenceId },
      });
      for (const row of rows) {
        const parsed = parseStanceLabel(row.payload);
        if (parsed !== null && parsed.runId === runId) {
          return parsed;
        }
      }
      return null;
    } catch (error) {
      throw new L0OperationError('Stance label lookup failed', error);
    }
  }

  async persistStanceLabel(input: {
    outboxId: string;
    runId: string;
    evidenceId: string;
    projectId: string;
    stance: StoredEvidenceStance;
    aiExecutionId: string;
    claimId: string | null;
    claimLinkId: string | null;
    correlationId: string;
  }): Promise<StanceLabelRecord> {
    await this.ensureConnected();
    try {
      const existing = await this.findStanceLabel(input.runId, input.evidenceId);
      if (existing !== null) {
        return existing;
      }
      void input.projectId;

      const record: StanceLabelRecord = {
        runId: input.runId,
        evidenceId: input.evidenceId,
        stance: input.stance,
        aiExecutionId: input.aiExecutionId,
        claimId: input.claimId,
      };

      await this.client().$transaction(async (tx) => {
        await tx.evidence.update({
          where: { id: input.evidenceId },
          data: { stance: toPrismaStance(input.stance) },
        });

        if (input.claimId !== null && input.claimLinkId !== null) {
          const existingLink = await tx.evidenceClaimLink.findUnique({
            where: {
              evidenceId_claimId: {
                evidenceId: input.evidenceId,
                claimId: input.claimId,
              },
            },
          });
          if (existingLink === null) {
            await tx.evidenceClaimLink.create({
              data: {
                id: input.claimLinkId,
                evidenceId: input.evidenceId,
                claimId: input.claimId,
                weight: new Prisma.Decimal('1'),
                stance: toPrismaStance(input.stance),
              },
            });
          }
        }

        await tx.outbox.create({
          data: {
            id: input.outboxId,
            aggregateType: 'evidence',
            aggregateId: input.evidenceId,
            eventType: STANCE_EVENT,
            schemaVersion: 1,
            payload: {
              runId: input.runId,
              evidenceId: input.evidenceId,
              stance: input.stance,
              aiExecutionId: input.aiExecutionId,
              ...(input.claimId !== null ? { claimId: input.claimId } : {}),
            },
            correlationId: input.correlationId,
          },
        });
      });

      return record;
    } catch (error) {
      const raced = await this.findStanceLabel(input.runId, input.evidenceId).catch(() => null);
      if (raced !== null) {
        return raced;
      }
      throw new L0OperationError('Stance label persist failed', error);
    }
  }

  async listClaimLinks(claimId: string): Promise<readonly EvidenceClaimLinkRecord[]> {
    await this.ensureConnected();
    try {
      const rows = await this.client().evidenceClaimLink.findMany({
        where: { claimId },
      });
      return rows.map((row) => ({
        id: row.id,
        evidenceId: row.evidenceId,
        claimId: row.claimId,
        stance: fromPrismaStance(row.stance),
      }));
    } catch (error) {
      throw new L0OperationError('Claim-link lookup failed', error);
    }
  }

  private client() {
    return this.database.getPrismaClient();
  }

  private async ensureConnected(): Promise<void> {
    await this.database.connect();
  }
}

function toClaim(row: {
  id: string;
  projectId: string;
  text: string;
  coverageAnnotation: Prisma.JsonValue;
}): ClaimRecord {
  const coverage = asRecord(row.coverageAnnotation);
  const provenance = parseProvenance(coverage);
  return {
    id: row.id,
    projectId: row.projectId,
    text: row.text,
    method: provenance.method,
    aiExecutionId: provenance.aiExecutionId,
    coverageAnnotation: coverage,
  };
}

function toArgument(row: {
  id: string;
  projectId: string;
  title: string;
  structure: Prisma.JsonValue;
}): ArgumentRecord {
  const structure = row.structure;
  const provenance = parseProvenance(
    typeof structure === 'object' && structure !== null && !Array.isArray(structure)
      ? (structure as Record<string, unknown>)
      : {},
  );
  const nested =
    typeof structure === 'object' &&
    structure !== null &&
    !Array.isArray(structure) &&
    typeof (structure as Record<string, unknown>).provenance === 'object'
      ? parseProvenance(
          ((structure as Record<string, unknown>).provenance ?? {}) as Record<string, unknown>,
        )
      : provenance;
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    structure,
    method: nested.method,
    aiExecutionId: nested.aiExecutionId,
  };
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseProvenance(record: Record<string, unknown>): {
  method: ClaimRecord['method'];
  aiExecutionId: string | null;
} {
  const nested =
    typeof record.provenance === 'object' &&
    record.provenance !== null &&
    !Array.isArray(record.provenance)
      ? (record.provenance as Record<string, unknown>)
      : record;
  const methodRaw = nested.method;
  const method =
    methodRaw === 'llm' || methodRaw === 'deterministic' || methodRaw === 'human'
      ? methodRaw
      : 'deterministic';
  const aiExecutionId =
    typeof nested.aiExecutionId === 'string' && nested.aiExecutionId.length > 0
      ? nested.aiExecutionId
      : null;
  return { method, aiExecutionId };
}

function toChunk(row: {
  id: string;
  projectId: string;
  documentVersionId: string;
  text: string;
  blockIds: string[];
}): ChunkRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    documentVersionId: row.documentVersionId,
    text: row.text,
    blockIds: row.blockIds,
  };
}

function toEvidence(row: {
  id: string;
  projectId: string;
  sourceId: string;
  chunkId: string | null;
  locator: Prisma.JsonValue;
  text: string;
  stance: EvidenceStance;
  extractionMethod: ExtractionMethod;
  aiExecutionId: string | null;
  type: EvidenceType;
}): EvidenceRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceId: row.sourceId,
    chunkId: row.chunkId,
    locator: parseLocator(row.locator),
    text: row.text,
    stance: fromPrismaStance(row.stance),
    extractionMethod: row.extractionMethod,
    aiExecutionId: row.aiExecutionId,
    type: row.type === EvidenceType.body_grounded ? 'body_grounded' : 'metadata_only',
  };
}

function parseLocator(value: Prisma.JsonValue): EvidenceRecord['locator'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { documentVersionId: '', blockId: '', page: 0 };
  }
  const record = value as Record<string, unknown>;
  return {
    documentVersionId: String(record.documentVersionId ?? ''),
    blockId: String(record.blockId ?? ''),
    page: Number(record.page ?? 0),
  };
}

function parseExtractionSet(payload: Prisma.JsonValue): ExtractionSetRecord | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const evidenceIds = Array.isArray(record.evidenceIds)
    ? record.evidenceIds.map((id) => String(id))
    : [];
  return {
    stepId: String(record.stepId ?? ''),
    runId: String(record.runId ?? ''),
    inputFingerprint: String(record.inputFingerprint ?? ''),
    aiExecutionId: String(record.aiExecutionId ?? ''),
    evidenceIds,
    omittedLocatorCount: Number(record.omittedLocatorCount ?? 0),
  };
}

function parseStanceLabel(payload: Prisma.JsonValue): StanceLabelRecord | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.runId !== 'string' || typeof record.evidenceId !== 'string') {
    return null;
  }
  return {
    runId: record.runId,
    evidenceId: record.evidenceId,
    stance: fromPrismaStance(String(record.stance)),
    aiExecutionId: String(record.aiExecutionId ?? ''),
    claimId: typeof record.claimId === 'string' ? record.claimId : null,
  };
}

function toPrismaStance(stance: StoredEvidenceStance): EvidenceStance {
  switch (stance) {
    case 'supports':
      return EvidenceStance.supports;
    case 'contradicts':
      return EvidenceStance.contradicts;
    case 'neutral':
      return EvidenceStance.neutral;
    case 'unresolved':
      return EvidenceStance.unresolved;
  }
}

function fromPrismaStance(stance: string): StoredEvidenceStance {
  if (
    stance === 'supports' ||
    stance === 'contradicts' ||
    stance === 'neutral' ||
    stance === 'unresolved'
  ) {
    return stance;
  }
  return 'unresolved';
}
