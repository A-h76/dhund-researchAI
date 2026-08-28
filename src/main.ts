import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvSecretsAdapter } from './l0/adapters/env/env-secrets.adapter';
import { ApiAppModule } from './apps/api/api-app.module';
import { WorkerAppModule } from './apps/worker/worker-app.module';
import {
  ConfigValidationError,
  getAppConfig,
  loadAndValidateConfig,
  setAppConfig,
} from './platform/config';
import { PlatformLogger } from './platform/logging';
import { parseRole, RuntimeRole } from './platform/runtime/role';

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function failBoot(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function validateBootConfig(role: RuntimeRole): void {
  const secrets = new EnvSecretsAdapter();
  try {
    setAppConfig(loadAndValidateConfig(secrets, role));
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      failBoot(error.message);
    }
    throw error;
  }
}

async function logBoot(
  logger: PlatformLogger,
  role: RuntimeRole,
  version: string,
  port?: number,
): Promise<void> {
  logger.info({
    module: 'boot',
    message: 'boot',
    role,
    version,
    ...(port !== undefined ? { port } : {}),
  });
}

async function bootstrapApi(version: string): Promise<void> {
  const app = await NestFactory.create(ApiAppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await app.init();
  const platformLogger = app.get(PlatformLogger);
  const { port } = getAppConfig();
  await app.listen(port);
  await logBoot(platformLogger, RuntimeRole.Api, version, port);
}

async function bootstrapWorker(version: string): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await app.init();
  const platformLogger = app.get(PlatformLogger);
  await logBoot(platformLogger, RuntimeRole.Worker, version);

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

async function bootstrap(): Promise<void> {
  const role = parseRole(process.argv);
  validateBootConfig(role);
  const version = readVersion();

  switch (role) {
    case RuntimeRole.Api:
      await bootstrapApi(version);
      break;
    case RuntimeRole.Worker:
      await bootstrapWorker(version);
      break;
    default: {
      const _exhaustive: never = role;
      throw new Error(`Unhandled role: ${String(_exhaustive)}`);
    }
  }
}

void bootstrap();
