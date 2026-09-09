import { field, type CatalogEventDefinition } from '../schema/types';

const orgId = field('orgId', 'string');
const userId = field('userId', 'string');
const projectId = field('projectId', 'string');
const email = field('email', 'string');

export const IAM_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'iam.user.registered',
    aggregateType: 'user',
    domain: 'iam',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, userId, email, field('displayName', 'string', false)],
      },
    ],
  },
  {
    eventType: 'iam.user.email_verified',
    aggregateType: 'user',
    domain: 'iam',
    currentVersion: 1,
    versions: [{ schemaVersion: 1, fields: [orgId, userId, email] }],
  },
  {
    eventType: 'iam.session.created',
    aggregateType: 'session',
    domain: 'iam',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, userId, field('sessionId', 'string'), field('familyId', 'string')],
      },
    ],
  },
  {
    eventType: 'iam.session.revoked',
    aggregateType: 'session',
    domain: 'iam',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, userId, field('sessionId', 'string'), field('reason', 'string', false)],
      },
    ],
  },
  {
    eventType: 'iam.refresh_token.family_revoked',
    aggregateType: 'refresh_token_family',
    domain: 'iam',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          userId,
          field('familyId', 'string'),
          field('sessionId', 'string'),
        ],
      },
    ],
  },
];

export const PROJECTS_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'projects.project.created',
    aggregateType: 'project',
    domain: 'projects',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, projectId, field('name', 'string'), field('createdBy', 'string')],
      },
    ],
  },
  {
    eventType: 'projects.membership.added',
    aggregateType: 'project_membership',
    domain: 'projects',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, projectId, userId, field('role', 'string')],
      },
    ],
  },
  {
    eventType: 'projects.membership.removed',
    aggregateType: 'project_membership',
    domain: 'projects',
    currentVersion: 1,
    versions: [{ schemaVersion: 1, fields: [orgId, projectId, userId] }],
  },
  {
    eventType: 'projects.break_glass.used',
    aggregateType: 'project',
    domain: 'projects',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, userId, projectId],
      },
    ],
  },
];

export const BILLING_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'billing.subscription.created',
    aggregateType: 'subscription',
    domain: 'billing',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, field('subscriptionId', 'string'), field('planId', 'string')],
      },
    ],
  },
  {
    eventType: 'billing.invoice.paid',
    aggregateType: 'invoice',
    domain: 'billing',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          field('invoiceId', 'string'),
          field('amountMicros', 'number'),
          field('currency', 'string'),
        ],
      },
    ],
  },
  {
    eventType: 'billing.usage.recorded',
    aggregateType: 'usage',
    domain: 'billing',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          field('metric', 'string'),
          field('quantity', 'number'),
          field('period', 'string'),
        ],
      },
    ],
  },
];

export const INGESTION_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'ingestion.document.uploaded',
    aggregateType: 'document',
    domain: 'ingestion',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          projectId,
          field('documentId', 'string'),
          field('documentVersionId', 'string'),
          field('contentHash', 'string'),
        ],
      },
    ],
  },
  {
    eventType: 'ingestion.document.extracted',
    aggregateType: 'document',
    domain: 'ingestion',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          projectId,
          field('documentVersionId', 'string'),
          field('extractorVersion', 'string'),
        ],
      },
    ],
  },
  {
    eventType: 'ingestion.chunk.created',
    aggregateType: 'chunk',
    domain: 'ingestion',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          projectId,
          field('documentVersionId', 'string'),
          field('chunkId', 'string'),
          field('ordinal', 'number'),
        ],
      },
    ],
  },
];

export const ORCHESTRATION_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'orchestration.research_run.started',
    aggregateType: 'research_run',
    domain: 'orchestration',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, projectId, field('runId', 'string'), field('mode', 'string')],
      },
    ],
  },
  {
    eventType: 'orchestration.research_run.completed',
    aggregateType: 'research_run',
    domain: 'orchestration',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, projectId, field('runId', 'string'), field('status', 'string')],
      },
    ],
  },
  {
    eventType: 'orchestration.research_run.failed',
    aggregateType: 'research_run',
    domain: 'orchestration',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          projectId,
          field('runId', 'string'),
          field('errorCode', 'string'),
        ],
      },
    ],
  },
  {
    eventType: 'orchestration.step.completed',
    aggregateType: 'research_run_step',
    domain: 'orchestration',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          projectId,
          field('runId', 'string'),
          field('stepId', 'string'),
          field('stepType', 'string'),
        ],
      },
    ],
  },
];

export const AI_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'ai.execution.recorded',
    aggregateType: 'ai_execution',
    domain: 'ai',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          field('executionId', 'string'),
          field('capability', 'string'),
          field('provider', 'string'),
          field('model', 'string'),
          field('costMicros', 'number'),
          field('projectId', 'string', false),
        ],
      },
    ],
  },
];

export const SCREENING_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'screening.decision.made',
    aggregateType: 'screening_decision',
    domain: 'screening',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          projectId,
          field('decisionId', 'string'),
          field('sourceId', 'string'),
          field('outcome', 'string'),
          field('runId', 'string', false),
        ],
      },
    ],
  },
  {
    eventType: 'screening.criteria.updated',
    aggregateType: 'screening_criteria',
    domain: 'screening',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          projectId,
          field('criteriaId', 'string'),
          field('version', 'number'),
        ],
      },
    ],
  },
];

export const IDENTITY_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'identity.person.resolved',
    aggregateType: 'person',
    domain: 'identity',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          field('personId', 'string'),
          field('identifierScheme', 'string'),
          field('identifierValue', 'string'),
        ],
      },
    ],
  },
  {
    eventType: 'identity.person.merged',
    aggregateType: 'person',
    domain: 'identity',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          field('survivorPersonId', 'string'),
          field('mergedPersonId', 'string'),
        ],
      },
    ],
  },
];

export const EXTERNAL_RECORDS_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'external_records.record.ingested',
    aggregateType: 'external_record',
    domain: 'external-records',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          field('recordId', 'string'),
          field('sourceSystem', 'string'),
          field('externalKey', 'string'),
        ],
      },
    ],
  },
  {
    eventType: 'external_records.record.refreshed',
    aggregateType: 'external_record',
    domain: 'external-records',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, field('recordId', 'string'), field('sourceSystem', 'string')],
      },
    ],
  },
];

export const DISCOVERY_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'discovery.search.completed',
    aggregateType: 'discovery_search',
    domain: 'discovery',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          projectId,
          field('searchId', 'string'),
          field('resultCount', 'number'),
          field('query', 'string'),
        ],
      },
    ],
  },
];

export const SOURCE_CONNECTORS_EVENTS: readonly CatalogEventDefinition[] = [
  {
    eventType: 'source_connectors.sync.started',
    aggregateType: 'connector_sync',
    domain: 'source-connectors',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [orgId, field('connectorId', 'string'), field('syncId', 'string')],
      },
    ],
  },
  {
    eventType: 'source_connectors.sync.completed',
    aggregateType: 'connector_sync',
    domain: 'source-connectors',
    currentVersion: 1,
    versions: [
      {
        schemaVersion: 1,
        fields: [
          orgId,
          field('connectorId', 'string'),
          field('syncId', 'string'),
          field('importedCount', 'number'),
        ],
      },
    ],
  },
];
