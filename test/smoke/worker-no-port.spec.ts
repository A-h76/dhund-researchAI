import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MAIN = join(ROOT, 'dist', 'main.js');

function hasSs(): boolean {
  try {
    execSync('ss -V', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function waitForBoot(proc: ReturnType<typeof spawn>, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for worker boot log'));
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      if (text.includes('"msg":"boot"') && text.includes('"role":"worker"')) {
        clearTimeout(timer);
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        resolve();
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Worker exited early with code ${code}`));
      }
    });
  });
}

function listeningLinesForPid(pid: number): string[] {
  const output = execSync(`ss -ltnp 2>/dev/null | grep "pid=${pid}," || true`, {
    encoding: 'utf8',
    shell: '/bin/sh',
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('worker smoke', () => {
  const runSmoke = hasSs() && existsSync(MAIN);

  (runSmoke ? it : it.skip)(
    'worker process exposes no listening TCP port',
    async () => {
      const proc = spawn('node', [MAIN, '--role=worker'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      if (!proc.pid) {
        throw new Error('Failed to spawn worker process');
      }

      try {
        await waitForBoot(proc);
        const listeners = listeningLinesForPid(proc.pid);
        expect(listeners).toEqual([]);
      } finally {
        proc.kill('SIGTERM');
      }
    },
    30_000,
  );
});
