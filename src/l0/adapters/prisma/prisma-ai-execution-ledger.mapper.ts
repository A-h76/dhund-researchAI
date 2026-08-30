import { AiCapability, AiMethod, AiStatus, Prisma } from '@prisma/client';
import type { AiExecutionLedgerRecord } from '../../ports/ai-execution-ledger.port';

function toPrismaCapability(capability: string): AiCapability {
  return capability as AiCapability;
}

function toPrismaStatus(status: AiExecutionLedgerRecord['status']): AiStatus {
  return status as AiStatus;
}

function toPrismaMethod(method: AiExecutionLedgerRecord['method']): AiMethod {
  return method as AiMethod;
}

export function mapLedgerRecordToPrismaCreate(input: AiExecutionLedgerRecord): {
  execution: Prisma.AiExecutionCreateInput;
  attempts: Prisma.AiExecutionAttemptCreateManyInput[];
} {
  const execution: Prisma.AiExecutionCreateInput = {
    id: input.id,
    capability: toPrismaCapability(input.capability),
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    inputFingerprint: input.inputFingerprint,
    status: toPrismaStatus(input.status),
    method: toPrismaMethod(input.method),
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costMicros: BigInt(input.costMicros),
    latencyMs: input.latencyMs,
    correlationId: input.correlationId,
    organization: { connect: { id: input.orgId } },
    ...(input.projectId !== undefined
      ? { project: { connect: { id: input.projectId } } }
      : {}),
    ...(input.researchRunId !== undefined
      ? { researchRun: { connect: { id: input.researchRunId } } }
      : {}),
  };

  const attempts: Prisma.AiExecutionAttemptCreateManyInput[] = input.attempts.map(
    (attempt) => ({
      id: attempt.id,
      aiExecutionId: input.id,
      attemptNo: attempt.attemptNo,
      provider: attempt.provider,
      model: attempt.model,
      status: toPrismaStatus(attempt.status),
      error: attempt.error ?? null,
      latencyMs: attempt.latencyMs,
      costMicros: BigInt(attempt.costMicros),
    }),
  );

  return { execution, attempts };
}
