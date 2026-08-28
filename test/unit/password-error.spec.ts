import {
  DomainError,
  notFound,
  passwordRejected,
} from '../../src/platform/errors/domain-error';
import {
  ErrorCode,
  PASSWORD_POLICY_MIN_LENGTH,
  isPasswordRejectionDetails,
} from '../../src/platform/errors/error-codes';

describe('password rejection (Phase 8 §2.10 / GAP-PASSWORD-01)', () => {
  it('uses validation_error with closed rule vocabulary and min_length bound', () => {
    const error = passwordRejected('min_length');

    expect(error.code).toBe(ErrorCode.ValidationError);
    expect(error.userMessage).toBe('Password does not meet requirements.');
    expect(isPasswordRejectionDetails(error.details)).toBe(true);
    expect(error.details).toEqual({
      fields: [
        {
          field: 'password',
          rule: 'min_length',
          min: PASSWORD_POLICY_MIN_LENGTH,
        },
      ],
    });
  });

  it('supports breached and max_length without echoing a password', () => {
    const breached = passwordRejected('breached');
    const tooLong = passwordRejected('max_length');

    expect(breached.details).toEqual({
      fields: [{ field: 'password', rule: 'breached' }],
    });
    expect(tooLong.details).toEqual({
      fields: [{ field: 'password', rule: 'max_length' }],
    });
    expect(JSON.stringify(breached)).not.toContain('hunter');
  });

  it('never stores a password value on DomainError', () => {
    const secret = 'hunter2-should-never-appear';
    const error = new DomainError(ErrorCode.ValidationError, {
      details: { password: secret, fields: [{ field: 'password', rule: 'breached' }] },
    });

    expect(JSON.stringify(error.details)).toContain(secret);
    expect(error.message).not.toContain(secret);
    expect(error.userMessage).not.toContain(secret);
  });

  it('notFound carries no details', () => {
    const error = notFound({ module: 'projects' });
    expect(error.code).toBe(ErrorCode.NotFound);
    expect(error.details).toBeUndefined();
  });
});
