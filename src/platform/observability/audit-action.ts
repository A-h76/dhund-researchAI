import { containsForbiddenLeak, containsSensitiveKey } from '../errors/leakage-guard';
import type { AuditActorType, AuditEventAppendInput } from '../../l0/ports/audit-event.port';

export class AuditLeakError extends Error {
  constructor() {
    super('audit row rejected');
    this.name = 'AuditLeakError';
  }
}

export function auditedAppendInput(input: {
  readonly id: string;
  readonly actorType: AuditActorType;
  readonly actorId?: string;
  readonly action: string;
  readonly target: string;
  readonly correlationId: string;
  readonly scope?: Readonly<Record<string, unknown>>;
}): AuditEventAppendInput {
  const scope: Record<string, unknown> = {
    ...(input.scope ?? {}),
    target: input.target,
    actor: input.actorId ?? input.actorType,
  };
  if (
    containsForbiddenLeak(input.action) ||
    containsForbiddenLeak(input.target) ||
    containsForbiddenLeak(input.correlationId) ||
    containsForbiddenLeak(scope) ||
    containsSensitiveKey(scope)
  ) {
    throw new AuditLeakError();
  }
  return {
    id: input.id,
    actorType: input.actorType,
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    action: input.action,
    correlationId: input.correlationId,
    scope,
  };
}
