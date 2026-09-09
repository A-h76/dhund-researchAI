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
  'tokenHash',
  '*.tokenHash',
  'html',
  '*.html',
  'stack',
  '*.stack',
  'prompt',
  '*.prompt',
  'promptText',
  '*.promptText',
  'documentText',
  '*.documentText',
  'documentContent',
  '*.documentContent',
  'evidenceText',
  '*.evidenceText',
  'evidenceSummaries',
  '*.evidenceSummaries',
  'userPayload',
  '*.userPayload',
  'userMessage',
  '*.userMessage',
  'systemPrompt',
  '*.systemPrompt',
  'systemInstructions',
  '*.systemInstructions',
  'req.headers.authorization',
  'req.headers.cookie',
  'provider',
  '*.provider',
  'model',
  '*.model',
];

export function createPinoOptions(logLevel = 'info'): LoggerOptions {
  return {
    level: logLevel,
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
