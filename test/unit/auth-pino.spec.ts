import { Writable } from 'node:stream';
import pino from 'pino';
import { runWithCorrelationId } from '../../src/platform/logging/correlation-context';
import { createPinoOptions } from '../../src/platform/logging/pino.config';

describe('login pino leakage', () => {
  it('redacts accessToken, refreshToken, authorization, and password', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(createPinoOptions(), stream);
    const password = 'pino-login-secret-12';
    const refresh = 'family-id.super-secret-refresh';
    const access = 'header.payload.signature';

    runWithCorrelationId('cor-login-pino', () => {
      logger.info({
        module: 'iam',
        message: 'login.success',
        password,
        refreshToken: refresh,
        accessToken: access,
        authorization: `Bearer ${access}`,
      });
      logger.warn({
        module: 'iam',
        message: 'refresh.family_revoked',
        familyId: 'fam-1',
        sessionId: 'sess-1',
        reason: 'refresh_reuse',
      });
    });

    const output = lines.join('\n');
    expect(output).toContain('login.success');
    expect(output).toContain('refresh.family_revoked');
    expect(output).toContain('fam-1');
    expect(output).not.toContain(password);
    expect(output).not.toContain(refresh);
    expect(output).not.toContain(access);
    expect(output).not.toContain('Bearer ');
    expect(output).toContain('[Redacted]');
  });
});
