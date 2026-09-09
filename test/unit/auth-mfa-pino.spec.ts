import { Writable } from 'node:stream';
import pino from 'pino';
import { runWithCorrelationId } from '../../src/platform/logging/correlation-context';
import { createPinoOptions } from '../../src/platform/logging/pino.config';

describe('MFA pino leakage', () => {
  it('redacts recovery codes and otpauth URLs', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(createPinoOptions(), stream);
    const recoveryCode = 'AAAA-BBBB-CCCC-DDDD';
    const otpauthUrl = 'otpauth://totp/Dhund:user?secret=ABCDEF';

    runWithCorrelationId('cor-mfa-pino', () => {
      logger.info({
        module: 'iam',
        message: 'mfa.success',
        recoveryCode,
        recoveryCodes: [recoveryCode],
        otpauthUrl,
      });
    });

    const output = lines.join('\n');
    expect(output).toContain('mfa.success');
    expect(output).not.toContain(recoveryCode);
    expect(output).not.toContain('ABCDEF');
    expect(output).toContain('[Redacted]');
  });
});
