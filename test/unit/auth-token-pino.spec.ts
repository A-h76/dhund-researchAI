import { Writable } from 'node:stream';
import pino from 'pino';
import { runWithCorrelationId } from '../../src/platform/logging/correlation-context';
import { createPinoOptions } from '../../src/platform/logging/pino.config';

describe('verify/reset pino leakage', () => {
  it('redacts token, tokenHash, password, and html', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(createPinoOptions(), stream);
    const token = 'eyJhbGciOiJFZERTQSIsInR5cCI6ImRuLWF0K2p3dCJ9.payload.sig';
    const hash = 'aa'.repeat(32);
    const password = 'pino-reset-secret-12';
    const html = `<p>${token}</p>`;

    runWithCorrelationId('cor-verify-pino', () => {
      logger.info({
        module: 'iam',
        message: 'auth_token.issued',
        token,
        tokenHash: hash,
        password,
        html,
      });
    });

    const output = lines.join('\n');
    expect(output).toContain('auth_token.issued');
    expect(output).not.toContain(token);
    expect(output).not.toContain(hash);
    expect(output).not.toContain(password);
    expect(output).not.toContain('<p>');
    expect(output).toContain('[Redacted]');
  });
});
