import { Writable } from 'node:stream';
import pino from 'pino';
import { runWithCorrelationId } from '../../src/platform/logging/correlation-context';
import { createPinoOptions } from '../../src/platform/logging/pino.config';

function createCaptureLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  const logger = pino(createPinoOptions(), stream);
  return { logger, lines };
}

describe('pino redaction', () => {
  it('redacts sensitive keys centrally without leaking values', () => {
    const { logger, lines } = createCaptureLogger();

    runWithCorrelationId('cor-redact-1', () => {
      logger.info({
        module: 'test',
        message: 'security.probe',
        password: 'hunter2',
        prompt: 'secret prompt text',
        documentText: 'classified document body',
        evidenceText: 'classified evidence body',
        nested: {
          apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
          provider: 'voyage',
          model: 'voyage-4',
        },
      });
    });

    const output = lines.join('\n');
    expect(output).toContain('"correlationId":"cor-redact-1"');
    expect(output).toContain('"module":"test"');
    expect(output).toContain('"message":"security.probe"');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('secret prompt text');
    expect(output).not.toContain('classified document body');
    expect(output).not.toContain('classified evidence body');
    expect(output).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(output).not.toContain('voyage');
    expect(output).not.toContain('voyage-4');
    expect(output).toContain('[Redacted]');
  });
});
