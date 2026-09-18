export type EmbedBackfillRejection =
  | 'org_missing'
  | 'operator_missing'
  | 'scope_missing'
  | 'scope_conflict'
  | 'model_version_missing'
  | 'batch_id_missing';

export class EmbedBackfillPayloadError extends Error {
  constructor(
    readonly rejection: EmbedBackfillRejection,
    message: string,
  ) {
    super(message);
    this.name = 'EmbedBackfillPayloadError';
  }
}

export interface EmbedBackfillScope {
  readonly allProjects: boolean;
  readonly projects: readonly string[];
  readonly documentIds: readonly string[];
}

export interface EmbedBackfillRequest {
  readonly orgId: string;
  readonly operatorId: string;
  readonly scope: EmbedBackfillScope;
  readonly modelVersion: string;
  readonly batchId: string;
}

/**
 * GAP-ADMIN-JOB-01. A backfill must name what it touches: either every project
 * in the org, or an explicit project / document set. `allProjects` combined with
 * an explicit list is a contradiction and is rejected rather than resolved.
 */
export function parseEmbedBackfillRequest(raw: unknown): EmbedBackfillRequest {
  const record = asRecord(raw);

  const orgId = readNonEmptyString(record.orgId);
  if (orgId === null) {
    throw new EmbedBackfillPayloadError('org_missing', 'embed-backfill requires orgId');
  }

  const operatorId = readNonEmptyString(record.operatorId);
  if (operatorId === null) {
    throw new EmbedBackfillPayloadError(
      'operator_missing',
      'embed-backfill requires an operator identity',
    );
  }

  const modelVersion = readNonEmptyString(record.modelVersion);
  if (modelVersion === null) {
    throw new EmbedBackfillPayloadError(
      'model_version_missing',
      'embed-backfill requires modelVersion',
    );
  }

  const batchId = readNonEmptyString(record.batchId);
  if (batchId === null) {
    throw new EmbedBackfillPayloadError('batch_id_missing', 'embed-backfill requires batchId');
  }

  return { orgId, operatorId, scope: parseScope(record.scope), modelVersion, batchId };
}

export interface EmbedBackfillJobPayload extends Record<string, unknown> {
  readonly orgId: string;
  readonly operatorId: string;
  readonly modelVersion: string;
  readonly batchId: string;
  readonly scope: {
    readonly allProjects: boolean;
    readonly projects: readonly string[];
    readonly documentIds: readonly string[];
  };
}

/** The job payload the worker consumes; scope is stored as a plain object. */
export function toEmbedBackfillJobPayload(
  request: EmbedBackfillRequest,
): EmbedBackfillJobPayload {
  return {
    orgId: request.orgId,
    operatorId: request.operatorId,
    modelVersion: request.modelVersion,
    batchId: request.batchId,
    scope: {
      allProjects: request.scope.allProjects,
      projects: [...request.scope.projects],
      documentIds: [...request.scope.documentIds],
    },
  };
}

function parseScope(raw: unknown): EmbedBackfillScope {
  const record = asRecord(raw, 'scope_missing', 'embed-backfill requires a scope object');

  const allProjects = record.allProjects === true;
  const projects = readStringList(record.projects);
  const documentIds = readStringList(record.documentIds);

  if (allProjects && (projects.length > 0 || documentIds.length > 0)) {
    throw new EmbedBackfillPayloadError(
      'scope_conflict',
      'embed-backfill scope cannot set allProjects together with an explicit project or document set',
    );
  }

  if (!allProjects && projects.length === 0 && documentIds.length === 0) {
    throw new EmbedBackfillPayloadError(
      'scope_missing',
      'embed-backfill scope requires allProjects, projects, or documentIds',
    );
  }

  return { allProjects, projects, documentIds };
}

function asRecord(
  value: unknown,
  rejection: EmbedBackfillRejection = 'scope_missing',
  message = 'embed-backfill payload must be an object',
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EmbedBackfillPayloadError(rejection, message);
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringList(value: unknown): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => readNonEmptyString(entry) === null)) {
    throw new EmbedBackfillPayloadError(
      'scope_missing',
      'embed-backfill scope lists must contain non-empty strings',
    );
  }
  return value as readonly string[];
}
