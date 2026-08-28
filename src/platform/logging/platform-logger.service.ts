import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

export interface PlatformLogFields {
  readonly module: string;
  readonly message: string;
  readonly [key: string]: unknown;
}

@Injectable()
export class PlatformLogger {
  constructor(private readonly logger: PinoLogger) {}

  info(fields: PlatformLogFields): void {
    this.write('info', fields);
  }

  error(fields: PlatformLogFields): void {
    this.write('error', fields);
  }

  warn(fields: PlatformLogFields): void {
    this.write('warn', fields);
  }

  debug(fields: PlatformLogFields): void {
    this.write('debug', fields);
  }

  private write(
    level: 'info' | 'error' | 'warn' | 'debug',
    fields: PlatformLogFields,
  ): void {
    const { module, message, ...rest } = fields;
    this.logger[level]({ module, ...rest }, message);
  }
}
