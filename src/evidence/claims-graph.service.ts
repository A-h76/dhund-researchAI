import { Inject, Injectable } from '@nestjs/common';
import {
  EVIDENCE_SPINE,
  type ArgumentClaimLinkRecord,
  type ArgumentRecord,
  type ClaimRecord,
  type ClaimSupportStatus,
  type EvidenceClaimLinkRecord,
  type EvidenceSpinePort,
  type GenerationMethod,
  type StoredEvidenceStance,
} from '../l0/ports/evidence-spine.port';
import { DomainError } from '../platform/errors/domain-error';
import { ErrorCode } from '../platform/errors/error-codes';
import { generateId } from '../platform/ids/uuid-v7';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import { relationalReachability } from './claim-arg-conformance';
import { ClaimsMetrics } from './claims.metrics';

export interface CreateClaimInput {
  readonly projectId: string;
  readonly text: string;
  readonly method: GenerationMethod;
  readonly aiExecutionId?: string;
}

export interface CreateArgumentInput {
  readonly projectId: string;
  readonly title: string;
  readonly structure?: unknown;
  readonly method: GenerationMethod;
  readonly aiExecutionId?: string;
}

export interface ClaimView {
  readonly claim: ClaimRecord;
  readonly supportStatus: ClaimSupportStatus;
  readonly evidenceLinks: readonly EvidenceClaimLinkRecord[];
  readonly argumentLinks: readonly ArgumentClaimLinkRecord[];
}

@Injectable()
export class ClaimsGraphService {
  constructor(
    @Inject(EVIDENCE_SPINE) private readonly spine: EvidenceSpinePort,
    private readonly metrics: ClaimsMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async createClaim(input: CreateClaimInput): Promise<ClaimRecord> {
    const provenance = buildProvenance(input.method, input.aiExecutionId);
    const claim = await this.spine.createClaim({
      id: generateId(),
      projectId: input.projectId,
      text: input.text,
      coverageAnnotation: provenance,
    });
    this.metrics.recordClaimCreated('unsupported');
    this.logger.info({
      module: 'evidence',
      message: 'claim.created',
      claimId: claim.id,
      projectId: input.projectId,
      method: claim.method,
      supportStatus: 'unsupported',
    });
    return claim;
  }

  async createArgument(input: CreateArgumentInput): Promise<ArgumentRecord> {
    const provenance = buildProvenance(input.method, input.aiExecutionId);
    const structure = mergeStructure(input.structure, provenance);
    return this.spine.createArgument({
      id: generateId(),
      projectId: input.projectId,
      title: input.title,
      structure,
    });
  }

  async getClaim(projectId: string, claimId: string): Promise<ClaimView> {
    const claim = await this.requireClaim(projectId, claimId);
    const evidenceLinks = await this.spine.listClaimLinks(claimId);
    const argumentLinks = await this.spine.listArgumentsForClaim(claimId);
    const supportStatus = supportStatusFromLinks(evidenceLinks);
    return { claim, supportStatus, evidenceLinks, argumentLinks };
  }

  async deleteClaim(projectId: string, claimId: string): Promise<void> {
    const claim = await this.requireClaim(projectId, claimId);
    const argumentLinks = await this.spine.countArgumentLinksForClaim(claim.id);
    const evidenceLinks = await this.spine.countEvidenceLinksForClaim(claim.id);
    if (argumentLinks > 0 || evidenceLinks > 0) {
      throw new DomainError(ErrorCode.InvalidStateTransition, {
        module: 'evidence',
        userMessage: 'This claim is linked and cannot be deleted.',
      });
    }
    await this.spine.softDeleteClaim(claim.id, projectId);
  }

  async linkClaimToArgument(input: {
    projectId: string;
    argumentId: string;
    claimId: string;
    role?: string;
    ordinal?: number;
  }): Promise<ArgumentClaimLinkRecord> {
    const argument = await this.spine.findArgument(input.argumentId, input.projectId);
    if (argument === null) {
      throw new DomainError(ErrorCode.NotFound, { module: 'evidence' });
    }
    const claim = await this.requireClaim(input.projectId, input.claimId);
    const link = await this.spine.linkArgumentClaim({
      id: generateId(),
      argumentId: argument.id,
      claimId: claim.id,
      projectId: input.projectId,
      role: input.role ?? null,
      ordinal: input.ordinal ?? null,
    });
    this.metrics.recordArgumentLink();
    return link;
  }

  async listClaimsForArgument(
    projectId: string,
    argumentId: string,
  ): Promise<{
    readonly argument: ArgumentRecord;
    readonly relationalClaimIds: readonly string[];
    readonly jsonbOnlyClaimIds: readonly string[];
    readonly reachabilityPasses: boolean;
  }> {
    const argument = await this.spine.findArgument(argumentId, projectId);
    if (argument === null) {
      throw new DomainError(ErrorCode.NotFound, { module: 'evidence' });
    }
    const links = await this.spine.listArgumentClaims(argument.id);
    const relationalClaimIds = links.map((link) => link.claimId);
    const reachability = relationalReachability({
      structure: argument.structure,
      relationalClaimIds,
    });
    return {
      argument,
      relationalClaimIds,
      jsonbOnlyClaimIds: reachability.jsonbOnlyClaimIds,
      reachabilityPasses: reachability.passes,
    };
  }

  async linkEvidenceToClaim(input: {
    projectId: string;
    evidenceId: string;
    claimId: string;
    stance: StoredEvidenceStance;
    weight?: string;
  }): Promise<EvidenceClaimLinkRecord> {
    const claim = await this.requireClaim(input.projectId, input.claimId);
    const evidence = await this.spine.findEvidence(input.evidenceId, input.projectId);
    if (evidence === null) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: 'evidence',
        userMessage: 'Cross-project or unknown evidence cannot be linked.',
      });
    }
    return this.spine.linkEvidenceClaim({
      id: generateId(),
      evidenceId: evidence.id,
      claimId: claim.id,
      stance: input.stance,
      weight: input.weight ?? '1',
    });
  }

  private async requireClaim(projectId: string, claimId: string): Promise<ClaimRecord> {
    const claim = await this.spine.findClaim(claimId, projectId);
    if (claim === null) {
      throw new DomainError(ErrorCode.NotFound, { module: 'evidence' });
    }
    return claim;
  }
}

function buildProvenance(
  method: GenerationMethod,
  aiExecutionId: string | undefined,
): Record<string, unknown> {
  if (method === 'llm' && (aiExecutionId === undefined || aiExecutionId.length === 0)) {
    throw new DomainError(ErrorCode.ValidationError, {
      module: 'evidence',
      userMessage: 'Generated claims and arguments require aiExecutionId.',
    });
  }
  return {
    method,
    ...(aiExecutionId !== undefined ? { aiExecutionId } : {}),
  };
}

function mergeStructure(
  structure: unknown,
  provenance: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    typeof structure === 'object' && structure !== null && !Array.isArray(structure)
      ? { ...(structure as Record<string, unknown>) }
      : {};
  return { ...base, provenance };
}

export function supportStatusFromLinks(
  links: readonly EvidenceClaimLinkRecord[],
): ClaimSupportStatus {
  const supporting = links.some((link) => link.stance === 'supports');
  const contradicting = links.some((link) => link.stance === 'contradicts');
  if (supporting && contradicting) {
    return 'conflicting';
  }
  if (supporting) {
    return 'supported';
  }
  return 'unsupported';
}
