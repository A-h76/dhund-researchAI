import {
  clientMessageFor,
  ErrorCode,
  PASSWORD_POLICY_MIN_LENGTH,
  type PasswordRejectionDetails,
  type PasswordRejectionRule,
} from './error-codes';

export interface DomainErrorOptions {
  details?: unknown;
  module?: string;
  cause?: unknown;
  serverDetail?: unknown;
  userMessage?: string;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown | undefined;
  readonly module: string;
  readonly serverDetail: unknown | undefined;
  readonly userMessage: string;

  constructor(code: ErrorCode, options: DomainErrorOptions = {}) {
    const userMessage = options.userMessage ?? clientMessageFor(code);
    super(
      userMessage,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'DomainError';
    this.code = code;
    this.details = options.details;
    this.module = options.module ?? 'api';
    this.serverDetail = options.serverDetail;
    this.userMessage = userMessage;
  }
}

export function notFound(
  options: Omit<DomainErrorOptions, 'details'> = {},
): DomainError {
  return new DomainError(ErrorCode.NotFound, options);
}

export function passwordRejected(
  rule: PasswordRejectionRule,
  options: Omit<DomainErrorOptions, 'details' | 'userMessage'> = {},
): DomainError {
  const field =
    rule === 'min_length'
      ? { field: 'password' as const, rule, min: PASSWORD_POLICY_MIN_LENGTH }
      : { field: 'password' as const, rule };

  const details: PasswordRejectionDetails = { fields: [field] };

  return new DomainError(ErrorCode.ValidationError, {
    ...options,
    details,
    userMessage: 'Password does not meet requirements.',
  });
}
