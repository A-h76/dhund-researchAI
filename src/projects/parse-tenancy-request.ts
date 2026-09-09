import { DomainError, ErrorCode } from '../platform/errors';
import {
  isProjectRole,
  type ProjectRole,
} from '../platform/authorization/roles';
import { isUuid } from '../platform/ids/uuid-v7';

function malformed(): DomainError {
  return new DomainError(ErrorCode.MalformedRequest, { module: 'projects' });
}

function invalid(): DomainError {
  return new DomainError(ErrorCode.ValidationError, { module: 'projects' });
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw malformed();
  }
  return body as Record<string, unknown>;
}

function requiredName(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalid();
  }
  const name = value.trim();
  if (name.length === 0) {
    throw invalid();
  }
  return name;
}

function optionalSettings(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid();
  }
  return value as Record<string, unknown>;
}

export function parseOrgPatch(body: unknown): { name: string } {
  const record = asObject(body);
  if (record.name === undefined) {
    throw invalid();
  }
  return { name: requiredName(record.name) };
}

export function parseProjectCreate(body: unknown): {
  name: string;
  settings: Record<string, unknown>;
} {
  const record = asObject(body);
  return {
    name: requiredName(record.name),
    settings: optionalSettings(record.settings) ?? {},
  };
}

export function parseProjectPatch(body: unknown): {
  name?: string;
  settings?: Record<string, unknown>;
} {
  const record = asObject(body);
  const name = record.name === undefined ? undefined : requiredName(record.name);
  const settings = optionalSettings(record.settings);
  if (name === undefined && settings === undefined) {
    throw invalid();
  }
  return { name, settings };
}

export function parseMembershipGrant(body: unknown): {
  userId: string;
  role: ProjectRole;
} {
  const record = asObject(body);
  if (typeof record.userId !== 'string' || !isUuid(record.userId)) {
    throw invalid();
  }
  if (typeof record.role !== 'string' || !isProjectRole(record.role)) {
    throw invalid();
  }
  return { userId: record.userId, role: record.role };
}

export function parseMembershipRolePatch(body: unknown): { role: ProjectRole } {
  const record = asObject(body);
  if (typeof record.role !== 'string' || !isProjectRole(record.role)) {
    throw invalid();
  }
  return { role: record.role };
}
