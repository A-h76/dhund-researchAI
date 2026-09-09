import { Inject, Injectable } from '@nestjs/common';
import {
  OUTBOX_SERVICE,
  REGISTRATION_STORE,
  isRegistrationConflict,
  type OutboxPort,
  type RegistrationStore,
} from '../../l0/ports';
import { generateId } from '../../platform/ids/uuid-v7';
import { DomainError, ErrorCode } from '../../platform/errors';
import { OutboxWriterService } from '../../platform/events';
import { requireCorrelationId } from '../../platform/logging';
import { PasswordPolicy } from '../password/password-policy';
import { PASSWORD_HASHER, type PasswordHasher } from '../password/password-hasher';
import { parseRegisterRequest, type ParsedRegisterRequest } from './parse-register-request';
import { RegistrationMetrics } from './registration.metrics';

export const REGISTER_SUCCESS_BODY = { status: 'pending_verification' } as const;

export type RegisterResponse = typeof REGISTER_SUCCESS_BODY;

@Injectable()
export class RegistrationService {
  constructor(
    private readonly policy: PasswordPolicy,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(REGISTRATION_STORE) private readonly store: RegistrationStore,
    @Inject(OUTBOX_SERVICE) private readonly outbox: OutboxPort,
    private readonly outboxWriter: OutboxWriterService,
    private readonly metrics: RegistrationMetrics,
  ) {}

  async register(body: unknown): Promise<RegisterResponse> {
    let parsed: ParsedRegisterRequest;
    try {
      parsed = parseRegisterRequest(body);
      await this.policy.assertAcceptable(parsed.password);
    } catch (error) {
      this.recordInputFailure(error);
      throw error;
    }

    const passwordHash = await this.hasher.hash(parsed.password);

    const userId = generateId();
    const orgId = generateId();
    const payload: Record<string, unknown> = {
      orgId,
      userId,
      email: parsed.email,
      ...(parsed.displayName !== undefined
        ? { displayName: parsed.displayName }
        : {}),
    };

    try {
      await this.outbox.withTransaction(async (tx) => {
        await this.store.insert(tx, {
          user: {
            id: userId,
            email: parsed.email,
            displayName: parsed.storedDisplayName,
          },
          credential: {
            id: generateId(),
            userId,
            passwordHash,
          },
          organization: {
            id: orgId,
            name: 'Personal',
            ownerUserId: userId,
          },
          membership: {
            id: generateId(),
            orgId,
            userId,
          },
        });

        await this.outboxWriter.appendInTransaction(tx, {
          eventType: 'iam.user.registered',
          aggregateType: 'user',
          aggregateId: userId,
          orgId,
          payload,
        });

        await this.outbox.appendStateMarker(tx, {
          id: generateId(),
          action: 'iam.user.registered',
          correlationId: requireCorrelationId(),
          scope: { userId, orgId },
        });
      });
    } catch (error) {
      if (isRegistrationConflict(error)) {
        this.metrics.recordSuccess();
        return REGISTER_SUCCESS_BODY;
      }
      this.metrics.recordFailure();
      throw error;
    }

    this.metrics.recordSuccess();
    return REGISTER_SUCCESS_BODY;
  }

  private recordInputFailure(error: unknown): void {
    if (
      error instanceof DomainError &&
      (error.code === ErrorCode.ValidationError ||
        error.code === ErrorCode.MalformedRequest)
    ) {
      this.metrics.recordValidationFailure();
      return;
    }
    this.metrics.recordFailure();
  }
}
