import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findLayerViolations } from '../../../src/platform/layering/layer-rules';

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

const ROOT = join(__dirname, '..', '..', '..');

const SDK_IMPORT_RE =
  /(?:from\s+|import\s*\()\s*['"](?:openai|voyageai|@anthropic-ai\/[^'"]+|@google\/[^'"]+)['"]/;

const PROVIDER_STRING_RES = [
  /\bgpt-/,
  /\bclaude-/,
  /\bgemini-/,
  /\btext-embedding/,
  /\bvoyage-/,
  /api\.openai\.com/,
  /api\.voyageai\.com/,
  /api\.anthropic\.com/,
  /generativelanguage\.googleapis\.com/,
] as const;

const RAW_HTTP_RE =
  /\b(?:fetch\s*\(|axios\b|from\s+['"]undici['"]|require\(\s*['"]undici['"]\)|from\s+['"]axios['"])/;

const PROVIDER_HOST_RE =
  /api\.openai\.com|api\.voyageai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/;

const PHI_RE =
  /\b(?:"|')?(?:patient_id|patient_name|mrn|medical_record_number|clinical_identifier|ssn|social_security)(?:"|')?\b/i;

const PRESETS_TABLE_RE = /create\s+table\s+"?research_run_presets"?/i;

const HTTP_DECORATOR_RE =
  /@(Get|Post|Put|Patch|Delete|Head|Options|All)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;

const PUBLIC_ROUTES = new Set([
  'GET /',
  'GET /health',
  'GET /ready',
  'GET /capabilities/research-runs',
  'POST /v1/auth/register',
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
  'GET /v1/auth/jwks',
  'POST /v1/auth/verify-email',
  'POST /v1/auth/verify-email/resend',
  'POST /v1/auth/password/reset-request',
  'POST /v1/auth/password/reset',
  'POST /v1/auth/mfa/verify',
]);

const OWNER_NAMES = [
  'retrieval service',
  'AI gateway',
  'cost ledger',
  'orchestration coordinator',
  'ingestion pipeline',
] as const;

export type OwnerName = (typeof OWNER_NAMES)[number];

export function repoRoot(): string {
  return ROOT;
}

export function collectFiles(dir: string): SourceFile[] {
  const entries = readdirSync(dir);
  const files: SourceFile[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') {
        continue;
      }
      files.push(...collectFiles(fullPath));
      continue;
    }
    files.push({
      path: relative(ROOT, fullPath).replace(/\\/g, '/'),
      content: readFileSync(fullPath, 'utf8'),
    });
  }

  return files;
}

export function srcFiles(): SourceFile[] {
  return collectFiles(join(ROOT, 'src')).filter((file) => file.path.endsWith('.ts'));
}

function norm(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isAiAdapter(filePath: string): boolean {
  return norm(filePath).startsWith('src/ai/adapters/');
}

function isProviderStringAllowed(filePath: string): boolean {
  const path = norm(filePath);
  return (
    isAiAdapter(path) ||
    path.startsWith('src/ai/policy/') ||
    path === 'src/platform/errors/leakage-guard.ts' ||
    // Retrieval cannot import ai/. This file mirrors the locked embed model id.
    path === 'src/retrieval/embed-identity.ts'
  );
}

export function findSdkImportViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const path = norm(file.path);
    if (!path.startsWith('src/') || isAiAdapter(path)) {
      continue;
    }
    if (SDK_IMPORT_RE.test(file.content)) {
      violations.push(path);
    }
  }
  return violations;
}

export function findProviderStringViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const path = norm(file.path);
    if (!path.startsWith('src/') || isProviderStringAllowed(path)) {
      continue;
    }
    for (const pattern of PROVIDER_STRING_RES) {
      if (pattern.test(file.content)) {
        violations.push(`${path}: ${pattern.source}`);
      }
    }
  }
  return violations;
}

export function findRawProviderHttpViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const path = norm(file.path);
    if (!path.startsWith('src/') || isAiAdapter(path)) {
      continue;
    }
    if (RAW_HTTP_RE.test(file.content) && PROVIDER_HOST_RE.test(file.content)) {
      violations.push(path);
    }
  }
  return violations;
}

export function findAdapterBypassViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const path = norm(file.path);
    if (!path.startsWith('src/') || isAiAdapter(path) || !/\.invoke\s*\(/.test(file.content)) {
      continue;
    }
    if (path === 'src/ai/gateway/gateway.service.ts') {
      const invokeAt = file.content.search(/adapter\.invoke\s*\(/);
      const recordAt = file.content.search(/this\.ledger\.record\s*\(/);
      if (invokeAt === -1 || recordAt === -1 || recordAt < invokeAt) {
        violations.push(`${path}: adapter.invoke is not followed by ledger.record`);
      }
      continue;
    }
    violations.push(`${path}: adapter invoke outside the AI gateway`);
  }
  return violations;
}

export function executionLedgerGap(
  adapterInvocations: number,
  ledgerRows: number,
): string | null {
  if (adapterInvocations < 1) {
    return 'no adapter invocation was observed';
  }
  if (adapterInvocations !== ledgerRows) {
    return `adapter invocations (${adapterInvocations}) do not match ai_executions rows (${ledgerRows})`;
  }
  return null;
}

function matchesOwner(name: OwnerName, file: SourceFile): boolean {
  const content = file.content;
  switch (name) {
    case 'retrieval service':
      return /class\s+\w+\s+implements\s+IRetrievalService\b/.test(content);
    case 'AI gateway':
      return /class\s+\w+\s+implements\s+IGatewayService\b/.test(content);
    case 'cost ledger':
      return /class\s+\w+\s+implements\s+AiExecutionLedgerPort\b/.test(content);
    case 'orchestration coordinator':
      return (
        /export class \w*Coordinator\b/.test(content) ||
        /export class OrchestrationModule\b/.test(content)
      );
    case 'ingestion pipeline':
      return (
        /export class \w*(?:IngestionPipeline|DocumentPipeline)\b/.test(content) ||
        (content.includes('ExtractProcessor') &&
          content.includes('ChunkProcessor') &&
          content.includes('EmbedProcessor'))
      );
    default: {
      const unhandled: never = name;
      throw new Error(`Unhandled owner ${String(unhandled)}`);
    }
  }
}

export function findSingleOwnerViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const name of OWNER_NAMES) {
    const hits = files
      .filter((file) => norm(file.path).startsWith('src/') && matchesOwner(name, file))
      .map((file) => norm(file.path))
      .sort();
    if (hits.length !== 1) {
      violations.push(`${name}: expected 1 owner, found ${hits.length} (${hits.join(', ')})`);
    }
  }
  return violations;
}

export function findImportDirectionViolations(files: readonly SourceFile[]): string[] {
  return findLayerViolations(
    files
      .filter((file) => norm(file.path).startsWith('src/') && file.path.endsWith('.ts'))
      .map((file) => ({ path: norm(file.path), content: file.content })),
  ).map(
    (violation) =>
      `${violation.file}: ${violation.importerLayer} imports ${violation.importedLayer} (${violation.importPath})`,
  );
}

function controllerPrefix(content: string): string {
  const match = content.match(/@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/);
  return match?.[1] ?? match?.[2] ?? '';
}

function joinRoute(controllerPath: string, methodPath: string): string {
  const parts = [controllerPath, methodPath]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0);
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

function decoratorCluster(lines: readonly string[], lineIndex: number): string {
  let start = lineIndex;
  while (start > 0) {
    const previous = lines[start - 1].trim();
    if (previous === '' || previous.startsWith('@') || previous.startsWith('//')) {
      start -= 1;
      continue;
    }
    break;
  }
  let end = lineIndex;
  while (end + 1 < lines.length) {
    const next = lines[end + 1].trim();
    if (next === '' || next.startsWith('@') || next.startsWith('//')) {
      end += 1;
      continue;
    }
    break;
  }
  return lines.slice(start, end + 1).join('\n');
}

export function findGuardViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];

  for (const file of files) {
    const path = norm(file.path);
    if (!path.startsWith('src/') || !path.endsWith('.controller.ts')) {
      continue;
    }
    const prefix = controllerPrefix(file.content);
    const lines = file.content.split(/\r?\n/);
    const seen = new Set<string>();

    for (let index = 0; index < lines.length; index += 1) {
      HTTP_DECORATOR_RE.lastIndex = 0;
      const match = HTTP_DECORATOR_RE.exec(lines[index]);
      if (match === null) {
        continue;
      }
      const method = match[1].toUpperCase();
      const methodPath = match[2] ?? match[3] ?? '';
      const route = `${method} ${joinRoute(prefix, methodPath)}`;
      if (seen.has(route)) {
        continue;
      }
      seen.add(route);
      const cluster = decoratorCluster(lines, index);
      const projectScoped = route.includes(':projectId');
      const hasProjectRole = /@RequireProjectRole\b/.test(cluster);
      const hasAuth = /@(?:RequireAuth|RequireOrgRole|RequireProjectRole|UseGuards)\b/.test(
        cluster,
      );
      if (projectScoped && !hasProjectRole) {
        violations.push(`missing @RequireProjectRole: ${route} (${path})`);
      }
      if (!PUBLIC_ROUTES.has(route) && !hasAuth) {
        violations.push(`missing auth guard: ${route} (${path})`);
      }
    }
  }

  return violations;
}

export function findSchemaViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  let vectorLocked = false;

  for (const file of files) {
    const path = norm(file.path);
    const sqlOrSchema = path.endsWith('.sql') || path.endsWith('schema.prisma');
    if (!sqlOrSchema) {
      continue;
    }
    if (PRESETS_TABLE_RE.test(file.content)) {
      violations.push(`${path}: research_run_presets table`);
    }
    const phi = file.content.match(new RegExp(PHI_RE.source, 'i'));
    if (phi !== null) {
      violations.push(`${path}: PHI column ${phi[0]}`);
    }
    if (
      path.endsWith('.sql') &&
      /chunk_embeddings/.test(file.content) &&
      /vector\s*\(\s*1024\s*\)/i.test(file.content) &&
      /vector_cosine_ops/.test(file.content)
    ) {
      vectorLocked = true;
    }
    if (path.endsWith('schema.prisma') && !/vector\(1024\)/.test(file.content)) {
      violations.push(`${path}: chunk_embeddings.vector is not VECTOR(1024)`);
    }
  }

  if (!vectorLocked) {
    violations.push('chunk_embeddings.vector is not VECTOR(1024) with vector_cosine_ops');
  }

  return violations;
}

export function findCoverageVocabularyViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const path = norm(file.path);
    if (path.startsWith('coverage/') || path.startsWith('dist/') || path.startsWith('node_modules/')) {
      continue;
    }
    if (/\bcorpus\b/i.test(file.content)) {
      violations.push(`${path}: corpus`);
    }
    const insideCoverage = /coverage/i.test(path) || /\bcoverage\b/i.test(file.content);
    if (insideCoverage && /\bstepOutcomes\b/.test(file.content)) {
      violations.push(`${path}: stepOutcomes inside coverage`);
    }
  }
  return violations;
}

export function findPhiFixtureViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const path = norm(file.path);
    if (!path.startsWith('test/fixtures/')) {
      continue;
    }
    const hits = file.content.match(new RegExp(PHI_RE.source, 'gi')) ?? [];
    for (const hit of hits) {
      violations.push(`${path}: ${hit}`);
    }
  }
  return violations;
}

export function findMigrationOrderViolations(dirNames: readonly string[]): string[] {
  const numbered = dirNames
    .map((name) => {
      const match = name.match(/_(\d{3})_/);
      return match === null ? null : { name, n: Number(match[1]) };
    })
    .filter((entry): entry is { name: string; n: number } => entry !== null);

  const violations: string[] = [];
  for (let n = 1; n <= 20; n += 1) {
    const count = numbered.filter((entry) => entry.n === n).length;
    if (count !== 1) {
      violations.push(`migration ${String(n).padStart(3, '0')}: expected 1, found ${count}`);
    }
  }

  const sorted = [...numbered].sort((left, right) => left.name.localeCompare(right.name));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.n < previous.n) {
      violations.push(`out of order: ${previous.name} before ${current.name}`);
    }
  }

  return violations;
}

export type IdorVerdict = 'pass' | 'block';

export function idorGateVerdict(status: number, body: unknown, secret: string): IdorVerdict {
  const serialized = JSON.stringify(body ?? null);
  const leaks = secret.length > 0 && serialized.includes(secret);
  if (status === 404 && !leaks) {
    return 'pass';
  }
  return 'block';
}
