import {
  ERROR_CODES,
  ERROR_REGISTRY,
  ErrorCode,
  httpStatusFor,
  isErrorCode,
} from '../../src/platform/errors/error-codes';

/**
 * Phase 8 §7 — authoritative error code registry.
 * Literal wire codes and HTTP statuses copied from the spec; not derived from
 * ErrorCode, ERROR_REGISTRY, or any implementation source.
 */
const PHASE_8_EXPECTED: ReadonlyArray<{
  code: string;
  status: number;
}> = [
  { code: 'malformed_request', status: 400 },
  { code: 'invalid_file_type', status: 400 },
  { code: 'invalid_filename', status: 400 },
  { code: 'magic_bytes_mismatch', status: 400 },
  { code: 'url_scheme_not_allowed', status: 400 },
  { code: 'url_target_blocked', status: 400 },
  { code: 'idempotency_key_required', status: 400 },
  { code: 'unauthenticated', status: 401 },
  { code: 'invalid_credentials', status: 401 },
  { code: 'mfa_required', status: 401 },
  { code: 'mfa_invalid', status: 401 },
  { code: 'mfa_recovery_invalid', status: 401 },
  { code: 'token_invalid', status: 401 },
  { code: 'refresh_invalid', status: 401 },
  { code: 'refresh_reuse_detected', status: 401 },
  { code: 'session_revoked', status: 401 },
  { code: 'forbidden', status: 403 },
  { code: 'csrf_invalid', status: 403 },
  { code: 'quota_exceeded', status: 403 },
  { code: 'feature_not_available', status: 403 },
  { code: 'concurrency_limit', status: 403 },
  { code: 'not_found', status: 404 },
  { code: 'invalid_state_transition', status: 409 },
  { code: 'already_exists', status: 409 },
  { code: 'email_taken', status: 409 },
  { code: 'idempotency_key_reused', status: 409 },
  { code: 'upload_not_completed', status: 409 },
  { code: 'session_expired', status: 409 },
  { code: 'document_not_ready', status: 409 },
  { code: 'import_session_not_cancellable', status: 409 },
  { code: 'file_too_large', status: 413 },
  { code: 'response_too_large', status: 413 },
  { code: 'validation_error', status: 422 },
  { code: 'pagination_invalid', status: 422 },
  { code: 'ai_data_boundary_violation', status: 422 },
  { code: 'extraction_value_type_mismatch', status: 422 },
  { code: 'library_item_target_invalid', status: 422 },
  { code: 'rate_limited', status: 429 },
  { code: 'internal_error', status: 500 },
  { code: 'retrieval_unavailable', status: 500 },
  { code: 'upstream_unavailable', status: 502 },
  { code: 'service_unavailable', status: 503 },
  { code: 'storage_unavailable', status: 503 },
  { code: 'ai_unavailable', status: 503 },
  { code: 'upstream_timeout', status: 504 },
];

const expectedCodes = PHASE_8_EXPECTED.map((entry) => entry.code);
const implementationCodes = [...ERROR_CODES];

describe('error code registry (Phase 8 §2 / §7)', () => {
  it('maps every registered code to the exact Phase 8 §7 HTTP status', () => {
    for (const { code, status } of PHASE_8_EXPECTED) {
      expect(isErrorCode(code)).toBe(true);
      expect(httpStatusFor(code as ErrorCode)).toBe(status);
      expect(ERROR_REGISTRY[code as ErrorCode].status).toBe(status);
    }
  });

  it('uses HTTP 422 for validation_error', () => {
    expect(httpStatusFor(ErrorCode.ValidationError)).toBe(422);
  });

  it('does not register invented codes', () => {
    expect(isErrorCode('password_rejected')).toBe(false);
    expect(isErrorCode('ssrf_rejected')).toBe(false);
    expect(isErrorCode('admission_denied')).toBe(false);
    expect(isErrorCode('insufficient_role')).toBe(false);
    expect(isErrorCode('dependency_unavailable')).toBe(false);
    expect(isErrorCode('provider_unavailable')).toBe(false);
    expect(isErrorCode('token_expired')).toBe(false);
  });

  it('covers every Phase 8 §7 code and no extras', () => {
    const sortedExpected = [...expectedCodes].sort();
    const sortedImplementation = [...implementationCodes].sort();

    // A. Every expected Phase 8 code exists in the implementation registry.
    for (const code of expectedCodes) {
      expect(isErrorCode(code)).toBe(true);
      expect(implementationCodes).toContain(code);
    }

    // B. Every implementation registry code exists in the expected Phase 8 list.
    for (const code of implementationCodes) {
      expect(expectedCodes).toContain(code);
    }

    // C. The two sets are exactly equal.
    expect(sortedImplementation).toEqual(sortedExpected);

    // D. Every expected code has the exact expected HTTP status.
    for (const { code, status } of PHASE_8_EXPECTED) {
      expect(httpStatusFor(code as ErrorCode)).toBe(status);
      expect(ERROR_REGISTRY[code as ErrorCode].status).toBe(status);
    }

    // E. The implementation has no unauthorized additional codes.
    const unauthorizedCodes = implementationCodes.filter(
      (code) => !expectedCodes.includes(code),
    );
    expect(unauthorizedCodes).toEqual([]);
    expect(implementationCodes).toHaveLength(expectedCodes.length);
  });
});
