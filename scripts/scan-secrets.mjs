import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);
const ALLOW = new Set(['test/unit/pino-redaction.spec.ts']);

export function findSecrets(root) {
  const hits = [];
  walk(root, root, hits);
  return hits;
}

function walk(root, dir, hits) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(root, full, hits);
      continue;
    }
    if (!stats.isFile() || stats.size > 1_000_000) {
      continue;
    }
    const rel = relative(root, full).replace(/\\/g, '/');
    if (ALLOW.has(rel)) {
      continue;
    }
    const text = readFileSync(full, 'utf8');
    for (const pattern of PATTERNS) {
      if (pattern.test(text)) {
        hits.push(rel);
        break;
      }
    }
  }
}

const root = process.argv[2] ?? process.cwd();
const hits = findSecrets(root);
if (hits.length > 0) {
  process.stderr.write(`secret scan failed:\n${hits.join('\n')}\n`);
  process.exit(1);
}
