export { GlobalExceptionFilter } from './global-exception.filter';
export { DomainError, notFound, passwordRejected } from './domain-error';
export {
  ErrorCode,
  ERROR_CODES,
  ERROR_REGISTRY,
  PASSWORD_POLICY_MIN_LENGTH,
  PASSWORD_REJECTION_RULES,
  clientMessageFor,
  httpStatusFor,
  isErrorCode,
  isPasswordRejectionDetails,
  isServerErrorStatus,
} from './error-codes';
export type {
  ErrorCodeDefinition,
  PasswordFieldRejection,
  PasswordRejectionDetails,
  PasswordRejectionRule,
} from './error-codes';
export type { ErrorEnvelope } from './error-envelope';
export { CORRELATION_ID_HEADER } from './error-envelope';
export { resolveCorrelationId } from './correlation-id';
export {
  containsForbiddenLeak,
  containsSensitiveKey,
  sanitizeForLog,
} from './leakage-guard';
