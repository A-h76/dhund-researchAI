import { Injectable } from '@nestjs/common';
import { readBearerToken } from '../iam/auth/parse-auth-request';
import { AccessContextService } from '../iam/authorization/access-context.service';
import { AccessTokenService } from '../iam/tokens/access-token.service';
import { type ScopedRow } from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { OutboxWriterService } from '../platform/events';
import { generateId } from '../platform/ids/uuid-v7';
import { getCorrelationId } from '../platform/logging';
import { projectScopeFrom } from '../platform/persistence/project-scope';
import { PlatformLogger } from '../platform/logging/platform-logger.service';
import { ScreeningDecisionsRepository } from './scoped-repos';
import { ScreeningMetrics } from './screening.metrics';
import type { ScreeningDecisionOutcome } from './screening.types';

const MODULE = 'orchestration';

export type { ScreeningDecisionOutcome };

export interface ScreeningDecisionDto {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string | null;
  readonly sourceId: string;
  readonly decision: ScreeningDecisionOutcome;
  readonly reason: string | null;
  readonly method: 'deterministic' | 'llm' | 'human';
  readonly aiExecutionId: string | null;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly supersededByDecisionId: string | null;
}

@Injectable()
export class ScreeningStubService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly accessContext: AccessContextService,
    private readonly decisions: ScreeningDecisionsRepository,
    private readonly outbox: OutboxWriterService,
    private readonly metrics: ScreeningMetrics,
    private readonly logger: PlatformLogger,
  ) {}

  async recordDecision(
    authorization: string | undefined,
    projectId: string,
    body: unknown,
  ): Promise<ScreeningDecisionDto> {
    const { userId, scope, orgId } = await this.authorize(authorization, projectId);
    const parsed = parseRecordDecisionBody(body);
    const id = generateId();
    const decidedAt = new Date();

    const method = parsed.aiExecutionId !== undefined ? 'llm' : 'deterministic';
    if (method === 'llm' && (parsed.aiExecutionId === undefined || parsed.aiExecutionId.length === 0)) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'AI-assisted screening decisions require aiExecutionId.',
      });
    }

    const row = await this.decisions.create(scope, {
      id,
      sourceId: parsed.sourceId,
      decision: parsed.decision,
      reason: parsed.reason ?? null,
      method,
      aiExecutionId: parsed.aiExecutionId ?? null,
      decidedBy: userId,
      decidedAt,
      ...(parsed.runId !== undefined ? { runId: parsed.runId } : {}),
    });

    await this.outbox.write({
      eventType: 'screening.decision.made',
      aggregateType: 'screening_decision',
      aggregateId: id,
      orgId,
      projectId: scope.projectId,
      payload: {
        orgId,
        projectId: scope.projectId,
        decisionId: id,
        sourceId: parsed.sourceId,
        outcome: parsed.decision,
        ...(parsed.runId !== undefined ? { runId: parsed.runId } : {}),
      },
      correlationId: getCorrelationId() ?? generateId(),
    });

    this.metrics.recordDecision(parsed.decision);
    this.logger.info({
      module: MODULE,
      message: 'screening.decision.recorded',
      decisionId: id,
      sourceId: parsed.sourceId,
      decision: parsed.decision,
      method,
    });

    return toDecisionDto(row);
  }

  async reverseDecision(
    authorization: string | undefined,
    projectId: string,
    decisionId: string,
    body: unknown,
  ): Promise<ScreeningDecisionDto> {
    const { userId, scope, orgId } = await this.authorize(authorization, projectId);
    const parsed = parseReverseDecisionBody(body);
    const original = await this.decisions.get(scope, decisionId);

    if (original.supersededByDecisionId !== null && original.supersededByDecisionId !== undefined) {
      throw new DomainError(ErrorCode.InvalidStateTransition, {
        module: MODULE,
        userMessage: 'Screening decision has already been superseded.',
      });
    }

    const successorId = generateId();
    const decidedAt = new Date();
    const method = parsed.aiExecutionId !== undefined ? 'llm' : 'deterministic';

    // uq_screening_current is (source_id, run_id) WHERE not superseded. Inserting a
    // second current row with the same run_id fails, so successors omit runId when
    // the original carried one. The original row (including runId) stays immutable.
    const successor = await this.decisions.create(scope, {
      id: successorId,
      sourceId: String(original.sourceId),
      decision: parsed.decision,
      reason: parsed.reason ?? null,
      method,
      aiExecutionId: parsed.aiExecutionId ?? null,
      decidedBy: userId,
      decidedAt,
    });

    // Append-only: only superseded_by_decision_id may change on the original row.
    await this.decisions.markSuperseded(scope, decisionId, successorId);

    await this.outbox.write({
      eventType: 'screening.decision.made',
      aggregateType: 'screening_decision',
      aggregateId: successorId,
      orgId,
      projectId: scope.projectId,
      payload: {
        orgId,
        projectId: scope.projectId,
        decisionId: successorId,
        sourceId: String(original.sourceId),
        outcome: parsed.decision,
        ...(typeof original.runId === 'string' ? { runId: original.runId } : {}),
      },
      correlationId: getCorrelationId() ?? generateId(),
    });

    this.metrics.recordDecision(parsed.decision);
    this.logger.info({
      module: MODULE,
      message: 'screening.decision.reversed',
      originalDecisionId: decisionId,
      successorDecisionId: successorId,
      decision: parsed.decision,
    });

    return toDecisionDto(successor);
  }

  async getDecision(
    authorization: string | undefined,
    projectId: string,
    decisionId: string,
  ): Promise<ScreeningDecisionDto> {
    const { scope } = await this.authorize(authorization, projectId);
    const row = await this.decisions.get(scope, decisionId);
    return toDecisionDto(row);
  }

  async listDecisions(
    authorization: string | undefined,
    projectId: string,
  ): Promise<readonly ScreeningDecisionDto[]> {
    const { scope } = await this.authorize(authorization, projectId);
    const rows = await this.decisions.list(scope, { limit: 100 });
    return rows.map(toDecisionDto);
  }

  private async authorize(authorization: string | undefined, projectId: string) {
    const user = await this.accessTokens.verify(readBearerToken(authorization));
    const context = await this.accessContext.resolve(user.sub);
    const scope = projectScopeFrom(context, projectId, MODULE);
    const membership = context.projects.find((row) => row.projectId === scope.projectId);
    if (membership === undefined) {
      throw new DomainError(ErrorCode.NotFound, { module: MODULE });
    }
    return { userId: user.sub, scope, orgId: membership.orgId };
  }
}

function parseRecordDecisionBody(body: unknown): {
  readonly sourceId: string;
  readonly decision: ScreeningDecisionOutcome;
  readonly reason?: string;
  readonly runId?: string;
  readonly aiExecutionId?: string;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DomainError(ErrorCode.MalformedRequest, { module: MODULE });
  }
  const record = body as Record<string, unknown>;
  if (typeof record.sourceId !== 'string' || record.sourceId.length === 0) {
    throw new DomainError(ErrorCode.ValidationError, {
      module: MODULE,
      userMessage: 'sourceId is required',
    });
  }
  if (!isDecisionOutcome(record.decision)) {
    throw new DomainError(ErrorCode.ValidationError, {
      module: MODULE,
      userMessage: 'decision must be include, exclude, or unresolved',
    });
  }
  return {
    sourceId: record.sourceId,
    decision: record.decision,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.runId === 'string' && record.runId.length > 0
      ? { runId: record.runId }
      : {}),
    ...(typeof record.aiExecutionId === 'string' && record.aiExecutionId.length > 0
      ? { aiExecutionId: record.aiExecutionId }
      : {}),
  };
}

function parseReverseDecisionBody(body: unknown): {
  readonly decision: ScreeningDecisionOutcome;
  readonly reason?: string;
  readonly aiExecutionId?: string;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DomainError(ErrorCode.MalformedRequest, { module: MODULE });
  }
  const record = body as Record<string, unknown>;
  if (!isDecisionOutcome(record.decision)) {
    throw new DomainError(ErrorCode.ValidationError, {
      module: MODULE,
      userMessage: 'decision must be include, exclude, or unresolved',
    });
  }
  return {
    decision: record.decision,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.aiExecutionId === 'string' && record.aiExecutionId.length > 0
      ? { aiExecutionId: record.aiExecutionId }
      : {}),
  };
}

function isDecisionOutcome(value: unknown): value is ScreeningDecisionOutcome {
  return value === 'include' || value === 'exclude' || value === 'unresolved';
}

function toDecisionDto(row: ScopedRow): ScreeningDecisionDto {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    runId: typeof row.runId === 'string' ? row.runId : null,
    sourceId: String(row.sourceId),
    decision: row.decision as ScreeningDecisionOutcome,
    reason: typeof row.reason === 'string' ? row.reason : null,
    method: row.method as 'deterministic' | 'llm' | 'human',
    aiExecutionId: typeof row.aiExecutionId === 'string' ? row.aiExecutionId : null,
    decidedBy: String(row.decidedBy),
    decidedAt:
      row.decidedAt instanceof Date
        ? row.decidedAt.toISOString()
        : String(row.decidedAt),
    supersededByDecisionId:
      typeof row.supersededByDecisionId === 'string' ? row.supersededByDecisionId : null,
  };
}
