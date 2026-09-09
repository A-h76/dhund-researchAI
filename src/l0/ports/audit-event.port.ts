export type AuditActorType = 'user' | 'system' | 'service';

export interface AuditEventAppendInput {
  readonly id: string;
  readonly actorType: AuditActorType;
  readonly actorId?: string;
  readonly action: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
}

export interface AuditEventPort {
  append(input: AuditEventAppendInput): Promise<void>;
}
