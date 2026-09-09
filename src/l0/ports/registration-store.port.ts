import { L0OperationError } from './errors';
import type { OutboxTransaction } from './outbox.port';

export class RegistrationConflictError extends L0OperationError {
  constructor() {
    super('registration conflict');
    this.name = 'RegistrationConflictError';
  }
}

export function isRegistrationConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (current instanceof RegistrationConflictError) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export interface RegistrationRecords {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
  };
  readonly credential: {
    readonly id: string;
    readonly userId: string;
    readonly passwordHash: string;
  };
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly ownerUserId: string;
  };
  readonly membership: {
    readonly id: string;
    readonly orgId: string;
    readonly userId: string;
  };
}

export interface RegistrationStore {
  insert(tx: OutboxTransaction, records: RegistrationRecords): Promise<void>;
}
