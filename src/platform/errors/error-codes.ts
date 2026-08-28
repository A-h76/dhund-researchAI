export const ErrorCode = {
  MalformedRequest: 'malformed_request',
  InvalidFileType: 'invalid_file_type',
  InvalidFilename: 'invalid_filename',
  MagicBytesMismatch: 'magic_bytes_mismatch',
  UrlSchemeNotAllowed: 'url_scheme_not_allowed',
  UrlTargetBlocked: 'url_target_blocked',
  IdempotencyKeyRequired: 'idempotency_key_required',
  Unauthenticated: 'unauthenticated',
  InvalidCredentials: 'invalid_credentials',
  MfaRequired: 'mfa_required',
  MfaInvalid: 'mfa_invalid',
  MfaRecoveryInvalid: 'mfa_recovery_invalid',
  TokenInvalid: 'token_invalid',
  RefreshInvalid: 'refresh_invalid',
  RefreshReuseDetected: 'refresh_reuse_detected',
  SessionRevoked: 'session_revoked',
  Forbidden: 'forbidden',
  CsrfInvalid: 'csrf_invalid',
  QuotaExceeded: 'quota_exceeded',
  FeatureNotAvailable: 'feature_not_available',
  ConcurrencyLimit: 'concurrency_limit',
  NotFound: 'not_found',
  InvalidStateTransition: 'invalid_state_transition',
  AlreadyExists: 'already_exists',
  EmailTaken: 'email_taken',
  IdempotencyKeyReused: 'idempotency_key_reused',
  UploadNotCompleted: 'upload_not_completed',
  SessionExpired: 'session_expired',
  DocumentNotReady: 'document_not_ready',
  ImportSessionNotCancellable: 'import_session_not_cancellable',
  FileTooLarge: 'file_too_large',
  ResponseTooLarge: 'response_too_large',
  ValidationError: 'validation_error',
  PaginationInvalid: 'pagination_invalid',
  AiDataBoundaryViolation: 'ai_data_boundary_violation',
  ExtractionValueTypeMismatch: 'extraction_value_type_mismatch',
  LibraryItemTargetInvalid: 'library_item_target_invalid',
  RateLimited: 'rate_limited',
  InternalError: 'internal_error',
  RetrievalUnavailable: 'retrieval_unavailable',
  UpstreamUnavailable: 'upstream_unavailable',
  ServiceUnavailable: 'service_unavailable',
  StorageUnavailable: 'storage_unavailable',
  AiUnavailable: 'ai_unavailable',
  UpstreamTimeout: 'upstream_timeout',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const PASSWORD_REJECTION_RULES = [
  'min_length',
  'breached',
  'max_length',
] as const;

export type PasswordRejectionRule = (typeof PASSWORD_REJECTION_RULES)[number];

export interface PasswordFieldRejection {
  readonly field: 'password';
  readonly rule: PasswordRejectionRule;
  readonly min?: number;
}

export interface PasswordRejectionDetails {
  readonly fields: readonly PasswordFieldRejection[];
}

export interface ErrorCodeDefinition {
  readonly status: number;
  readonly message: string;
}

export const ERROR_REGISTRY: Record<ErrorCode, ErrorCodeDefinition> = {
  [ErrorCode.MalformedRequest]: {
    status: 400,
    message: 'The request could not be parsed.',
  },
  [ErrorCode.InvalidFileType]: {
    status: 400,
    message: 'This file type is not allowed.',
  },
  [ErrorCode.InvalidFilename]: {
    status: 400,
    message: 'The filename is not valid.',
  },
  [ErrorCode.MagicBytesMismatch]: {
    status: 400,
    message: 'The file contents do not match the declared type.',
  },
  [ErrorCode.UrlSchemeNotAllowed]: {
    status: 400,
    message: 'This URL scheme is not allowed.',
  },
  [ErrorCode.UrlTargetBlocked]: {
    status: 400,
    message: 'This URL is not allowed.',
  },
  [ErrorCode.IdempotencyKeyRequired]: {
    status: 400,
    message: 'An Idempotency-Key header is required.',
  },
  [ErrorCode.Unauthenticated]: {
    status: 401,
    message: 'Authentication required.',
  },
  [ErrorCode.InvalidCredentials]: {
    status: 401,
    message: 'Authentication required.',
  },
  [ErrorCode.MfaRequired]: {
    status: 401,
    message: 'Multi-factor authentication required.',
  },
  [ErrorCode.MfaInvalid]: {
    status: 401,
    message: 'Authentication required.',
  },
  [ErrorCode.MfaRecoveryInvalid]: {
    status: 401,
    message: 'Authentication required.',
  },
  [ErrorCode.TokenInvalid]: {
    status: 401,
    message: 'Authentication required.',
  },
  [ErrorCode.RefreshInvalid]: {
    status: 401,
    message: 'Authentication required.',
  },
  [ErrorCode.RefreshReuseDetected]: {
    status: 401,
    message: 'Authentication required.',
  },
  [ErrorCode.SessionRevoked]: {
    status: 401,
    message: 'Authentication required.',
  },
  [ErrorCode.Forbidden]: {
    status: 403,
    message: 'Insufficient permissions.',
  },
  [ErrorCode.CsrfInvalid]: {
    status: 403,
    message: 'The request could not be validated.',
  },
  [ErrorCode.QuotaExceeded]: {
    status: 403,
    message: 'A usage limit for this organization has been reached.',
  },
  [ErrorCode.FeatureNotAvailable]: {
    status: 403,
    message: 'This feature is not available on the current plan.',
  },
  [ErrorCode.ConcurrencyLimit]: {
    status: 403,
    message:
      'Your organization has reached its concurrent research-run limit. Try again shortly.',
  },
  [ErrorCode.NotFound]: {
    status: 404,
    message: 'Resource not found.',
  },
  [ErrorCode.InvalidStateTransition]: {
    status: 409,
    message: 'This action is not valid in the current state.',
  },
  [ErrorCode.AlreadyExists]: {
    status: 409,
    message: 'The resource already exists.',
  },
  [ErrorCode.EmailTaken]: {
    status: 409,
    message: 'The resource already exists.',
  },
  [ErrorCode.IdempotencyKeyReused]: {
    status: 409,
    message: 'This idempotency key was reused with a different request.',
  },
  [ErrorCode.UploadNotCompleted]: {
    status: 409,
    message: 'The upload has not completed.',
  },
  [ErrorCode.SessionExpired]: {
    status: 409,
    message: 'The session has expired.',
  },
  [ErrorCode.DocumentNotReady]: {
    status: 409,
    message: 'This document is still processing and cannot be used yet.',
  },
  [ErrorCode.ImportSessionNotCancellable]: {
    status: 409,
    message: 'This import session can no longer be cancelled.',
  },
  [ErrorCode.FileTooLarge]: {
    status: 413,
    message: 'The file exceeds the allowed size.',
  },
  [ErrorCode.ResponseTooLarge]: {
    status: 413,
    message: 'The response exceeded the allowed size.',
  },
  [ErrorCode.ValidationError]: {
    status: 422,
    message: 'Request contains invalid fields.',
  },
  [ErrorCode.PaginationInvalid]: {
    status: 422,
    message: 'Pagination parameters are invalid.',
  },
  [ErrorCode.AiDataBoundaryViolation]: {
    status: 422,
    message: 'Request violates the AI data boundary.',
  },
  [ErrorCode.ExtractionValueTypeMismatch]: {
    status: 422,
    message: 'The value does not match the declared column type.',
  },
  [ErrorCode.LibraryItemTargetInvalid]: {
    status: 422,
    message: 'The library item target is invalid.',
  },
  [ErrorCode.RateLimited]: {
    status: 429,
    message: 'Too many requests.',
  },
  [ErrorCode.InternalError]: {
    status: 500,
    message: 'Internal error.',
  },
  [ErrorCode.RetrievalUnavailable]: {
    status: 500,
    message: 'Search is unavailable.',
  },
  [ErrorCode.UpstreamUnavailable]: {
    status: 502,
    message: 'This source is temporarily unavailable.',
  },
  [ErrorCode.ServiceUnavailable]: {
    status: 503,
    message: 'Temporarily unavailable. Retry shortly.',
  },
  [ErrorCode.StorageUnavailable]: {
    status: 503,
    message: 'Temporarily unavailable. Retry shortly.',
  },
  [ErrorCode.AiUnavailable]: {
    status: 503,
    message: 'Model processing failed. Retry shortly.',
  },
  [ErrorCode.UpstreamTimeout]: {
    status: 504,
    message: 'Temporarily unavailable. Retry shortly.',
  },
};

export const ERROR_CODES: readonly ErrorCode[] = Object.values(ErrorCode);

export const PASSWORD_POLICY_MIN_LENGTH = 12;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_REGISTRY;
}

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_REGISTRY[code].status;
}

export function clientMessageFor(code: ErrorCode): string {
  return ERROR_REGISTRY[code].message;
}

export function isServerErrorStatus(status: number): boolean {
  return status >= 500;
}

export function isPasswordRejectionDetails(
  value: unknown,
): value is PasswordRejectionDetails {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const fields = (value as { fields?: unknown }).fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    return false;
  }

  return fields.every((field) => isPasswordFieldRejection(field));
}

function isPasswordFieldRejection(value: unknown): value is PasswordFieldRejection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as { field?: unknown; rule?: unknown; min?: unknown };
  if (record.field !== 'password') {
    return false;
  }

  if (
    typeof record.rule !== 'string' ||
    !(PASSWORD_REJECTION_RULES as readonly string[]).includes(record.rule)
  ) {
    return false;
  }

  if (record.rule === 'min_length') {
    return record.min === PASSWORD_POLICY_MIN_LENGTH;
  }

  return record.min === undefined;
}
