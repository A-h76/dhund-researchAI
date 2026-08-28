import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiAppModule } from './apps/api/api-app.module';
import { WorkerAppModule } from './apps/worker/worker-app.module';
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

function logBoot(role: RuntimeRole, version: string, port?: number): void {
  const line = {
    msg: 'boot',
    role,
    version,
    ...(port !== undefined ? { port } : {}),
  };
  console.log(JSON.stringify(line));
}

async function bootstrapApi(version: string): Promise<void> {
  const app = await NestFactory.create(ApiAppModule, { bufferLogs: true });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logBoot(RuntimeRole.Api, version, port);
}

async function bootstrapWorker(version: string): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });
  logBoot(RuntimeRole.Worker, version);

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

async function bootstrap(): Promise<void> {
  const role = parseRole(process.argv);
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
