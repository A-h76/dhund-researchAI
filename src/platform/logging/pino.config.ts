import type { LoggerOptions } from 'pino';
import { getCorrelationId } from './correlation-context';

const LOGGER_REDACT_PATHS: readonly string[] = [
  'password',
  '*.password',
  'secret',
  '*.secret',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'apiKey',
  '*.apiKey',
  'authorization',
  '*.authorization',
  'stack',
  '*.stack',
  'prompt',
  '*.prompt',
  'promptText',
  '*.promptText',
  'documentText',
  '*.documentText',
  'evidenceText',
  '*.evidenceText',
  'req.headers.authorization',
  'req.headers.cookie',
  'provider',
  '*.provider',
  'model',
  '*.model',
];

export function createPinoOptions(): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    redact: {
      paths: [...LOGGER_REDACT_PATHS],
      censor: '[Redacted]',
    },
    mixin() {
      const correlationId = getCorrelationId();
      return correlationId === undefined ? {} : { correlationId };
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };
}
