import { Writable } from 'node:stream';
import pino from 'pino';
import { runWithCorrelationId } from '../../src/platform/logging/correlation-context';
import { createPinoOptions } from '../../src/platform/logging/pino.config';

describe('registration pino leakage', () => {
  it('redacts password if a log object includes the key and never prints the value', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(createPinoOptions(), stream);
    const secret = 'pino-register-secret-12';

    runWithCorrelationId('cor-reg-pino', () => {
      logger.info({
        module: 'iam',
        message: 'registration.success',
        password: secret,
      });
      logger.warn({
        module: 'iam',
        message: 'password.breach_list.degraded',
      });
    });

    const output = lines.join('\n');
    expect(output).toContain('registration.success');
    expect(output).toContain('password.breach_list.degraded');
    expect(output).not.toContain(secret);
    expect(output).toContain('[Redacted]');
  });
});
