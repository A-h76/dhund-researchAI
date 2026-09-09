import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ApiRootController } from '../../src/apps/api/api-root.controller';
import { CapabilityProbeController } from '../../src/apps/api/capability-probe.controller';
import { HealthController } from '../../src/apps/api/health.controller';
import { AuthController } from '../../src/iam/auth.controller';
import {
  REQUIRE_AUTH_KEY,
  REQUIRE_ORG_ROLE_KEY,
  REQUIRE_PROJECT_ROLE_KEY,
} from '../../src/iam/authorization/metadata';
import { DocumentsController } from '../../src/ingestion/documents.controller';
import { MembershipsController } from '../../src/projects/memberships.controller';
import { OrgsController } from '../../src/projects/orgs.controller';
import { ProjectsController } from '../../src/projects/projects.controller';
import { UploadsController } from '../../src/ingestion/uploads.controller';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

const HTTP_CONTROLLERS = [
  ApiRootController,
  HealthController,
  CapabilityProbeController,
  AuthController,
  DocumentsController,
  UploadsController,
  OrgsController,
  ProjectsController,
  MembershipsController,
] as const;

const EXPECTED_CONTROLLER_FILES = [
  'src/apps/api/api-root.controller.ts',
  'src/apps/api/capability-probe.controller.ts',
  'src/apps/api/health.controller.ts',
  'src/iam/auth.controller.ts',
  'src/ingestion/documents.controller.ts',
  'src/ingestion/uploads.controller.ts',
  'src/projects/memberships.controller.ts',
  'src/projects/orgs.controller.ts',
  'src/projects/projects.controller.ts',
];

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

interface CoveredRoute {
  readonly method: string;
  readonly path: string;
  readonly requireAuth: boolean;
  readonly orgRole: unknown;
  readonly projectRole: unknown;
}

function coverageViolations(routes: CoveredRoute[]): string[] {
  const violations: string[] = [];
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (PUBLIC_ROUTES.has(key)) {
      continue;
    }
    const guarded =
      route.requireAuth ||
      route.orgRole !== undefined ||
      route.projectRole !== undefined;
    if (!guarded) {
      violations.push(`missing auth guard: ${key}`);
    }
    if (
      route.path.startsWith('/v1/projects') &&
      route.projectRole === undefined
    ) {
      violations.push(`missing @RequireProjectRole: ${key}`);
    }
  }
  return violations;
}

function joinRoute(
  controllerPath: unknown,
  methodPath: unknown,
): string {
  const left = controllerPath === undefined || controllerPath === '/' ? '' : String(controllerPath);
  const right = methodPath === undefined || methodPath === '/' ? '' : String(methodPath);
  const joined = `/${left}/${right}`.replace(/\/+/g, '/');
  if (joined.length > 1 && joined.endsWith('/')) {
    return joined.slice(0, -1);
  }
  return joined === '' ? '/' : joined;
}

function enumerateControllers(
  controllers: ReadonlyArray<{ prototype: object; name?: string }>,
): CoveredRoute[] {
  const routes: CoveredRoute[] = [];
  for (const controller of controllers) {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, controller);
    const prototype = controller.prototype as Record<string, unknown>;
    for (const property of Object.getOwnPropertyNames(prototype)) {
      if (property === 'constructor') {
        continue;
      }
      const handler = prototype[property];
      if (typeof handler !== 'function') {
        continue;
      }
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      if (method === undefined) {
        continue;
      }
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler);
      routes.push({
        method: RequestMethod[method],
        path: joinRoute(controllerPath, methodPath),
        requireAuth: Reflect.getMetadata(REQUIRE_AUTH_KEY, handler) === true,
        orgRole: Reflect.getMetadata(REQUIRE_ORG_ROLE_KEY, handler),
        projectRole: Reflect.getMetadata(REQUIRE_PROJECT_ROLE_KEY, handler),
      });
    }
  }
  return routes;
}

function collectControllerFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectControllerFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.controller.ts')) {
      files.push(relative(ROOT, fullPath).replace(/\\/g, '/'));
    }
  }
  return files.sort();
}

describe('DHB-37 HTTP guard coverage', () => {
  it('fails CI when a non-public route is missing an auth guard', () => {
    expect(
      coverageViolations([
        {
          method: 'GET',
          path: '/v1/secret',
          requireAuth: false,
          orgRole: undefined,
          projectRole: undefined,
        },
      ]),
    ).toEqual(['missing auth guard: GET /v1/secret']);
  });

  it('requires @RequireProjectRole on every /v1/projects route', () => {
    expect(
      coverageViolations([
        {
          method: 'GET',
          path: '/v1/projects/:projectId',
          requireAuth: true,
          orgRole: undefined,
          projectRole: undefined,
        },
      ]),
    ).toEqual(['missing @RequireProjectRole: GET /v1/projects/:projectId']);
  });

  it('enumerates every HTTP controller and requires guards on protected routes', () => {
    expect(collectControllerFiles(SRC)).toEqual(EXPECTED_CONTROLLER_FILES);
    const routes = enumerateControllers(HTTP_CONTROLLERS);
    expect(routes.length).toBeGreaterThan(10);
    expect(coverageViolations(routes)).toEqual([]);
    expect(
      routes.some(
        (route) =>
          route.path === '/v1/auth/logout-all' && route.requireAuth,
      ),
    ).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.path === '/v1/projects/:projectId' &&
          route.projectRole === 'VIEWER',
      ),
    ).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.path === '/v1/projects/:projectId/documents/:documentId' &&
          route.projectRole === 'VIEWER',
      ),
    ).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.path === '/v1/projects/:projectId/uploads' &&
          route.projectRole === 'EDITOR',
      ),
    ).toBe(true);
    expect(
      routes.some(
        (route) =>
          route.path === '/v1/uploads/:sessionId/complete' && route.requireAuth,
      ),
    ).toBe(true);
  });
});
