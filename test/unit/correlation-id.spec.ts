import { randomUUID } from 'node:crypto';
import {
  readCorrelationHeader,
  resolveCorrelationId,
} from '../../src/platform/logging/correlation-id';

describe('resolveCorrelationId', () => {
  it('generates a UUID when the header is absent', () => {
    const id = resolveCorrelationId(undefined);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('honours a supplied correlation id', () => {
    expect(resolveCorrelationId('client-cor-123')).toBe('client-cor-123');
  });

  it('uses the first value when the header is an array', () => {
    expect(resolveCorrelationId(['first-id', 'second-id'])).toBe('first-id');
  });

  it('sanitises CRLF injection attempts in the header', () => {
    const injected = 'safe-id\r\nX-Evil: injected';
    expect(resolveCorrelationId(injected)).toBe('safe-idX-Evil: injected');
    expect(resolveCorrelationId(injected)).not.toContain('\r');
    expect(resolveCorrelationId(injected)).not.toContain('\n');
  });

  it('generates a UUID when the header is empty after sanitisation', () => {
    const id = resolveCorrelationId('   \r\n   ');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a UUID when the header exceeds 128 characters', () => {
    const tooLong = 'a'.repeat(129);
    const id = resolveCorrelationId(tooLong);
    expect(id).not.toBe(tooLong);
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('reads correlation headers case-insensitively', () => {
    expect(
      readCorrelationHeader({
        'x-correlation-id': 'lower',
      }),
    ).toBe('lower');
    expect(
      readCorrelationHeader({
        'X-Correlation-Id': 'mixed',
      }),
    ).toBe('mixed');
    expect(
      readCorrelationHeader({
        'X-Correlation-ID': 'upper',
      }),
    ).toBe('upper');
  });

  it('never introduces a second trace identifier', () => {
    const id = resolveCorrelationId(randomUUID());
    expect(id).not.toMatch(/trace/i);
    expect(id).not.toMatch(/causation/i);
  });
});
