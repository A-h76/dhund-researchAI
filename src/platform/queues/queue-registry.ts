import { dlqNameFor, hasR1Processor, type QueueName } from './queue-names';
import type { QueueAttemptsPolicy, QueueBackoffPolicy, QueuePolicy } from './queue-policy.types';

const EXPONENTIAL_BACKOFF: QueueBackoffPolicy = { type: 'exponential', delayMs: 1000 };

const BASE_REQUIRED = ['orgId', 'correlationId'] as const;

function fixed(attempts: number): QueueAttemptsPolicy {
  return { kind: 'fixed', attempts };
}

function policy(
  name: QueueName,
  attempts: QueueAttemptsPolicy,
  backoff: QueueBackoffPolicy | null,
  naturalKeyFields: readonly string[],
  requiredPayloadFields: readonly string[],
): QueuePolicy {
  return {
    name,
    attempts,
    backoff,
    dlqName: dlqNameFor(name),
    naturalKeyFields,
    requiredPayloadFields: [...BASE_REQUIRED, ...requiredPayloadFields],
    r1Processor: hasR1Processor(name),
  };
}

export const QUEUE_REGISTRY: Readonly<Record<QueueName, QueuePolicy>> = {
  extract: policy(
    'extract',
    fixed(5),
    EXPONENTIAL_BACKOFF,
    ['documentVersionId', 'extractorVersion', 'contentHash'],
    ['projectId', 'documentVersionId', 'contentHash', 'extractorVersion'],
  ),
  ocr: policy(
    'ocr',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['documentVersionId', 'extractorVersion', 'contentHash', 'ocr'],
    ['projectId', 'documentVersionId', 'blockRefs', 'extractorVersion', 'contentHash'],
  ),
  chunk: policy(
    'chunk',
    fixed(5),
    EXPONENTIAL_BACKOFF,
    ['documentVersionId', 'chunkerVersion', 'contentHash'],
    ['projectId', 'documentVersionId', 'chunkerVersion'],
  ),
  embed: policy(
    'embed',
    fixed(5),
    EXPONENTIAL_BACKOFF,
    ['chunkId', 'modelVersion', 'contentHash'],
    ['projectId', 'chunkId', 'modelVersion'],
  ),
  'embed-backfill': policy(
    'embed-backfill',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['scope', 'modelVersion', 'batchId'],
    ['modelVersion', 'batchId', 'scope'],
  ),
  'orphan-sweep': policy(
    'orphan-sweep',
    fixed(1),
    null,
    ['olderThan'],
    ['olderThan'],
  ),
  'research-run-tick': policy(
    'research-run-tick',
    { kind: 'infinite' },
    EXPONENTIAL_BACKOFF,
    ['runId', 'tickInstant'],
    ['projectId', 'runId', 'tickInstant'],
  ),
  'research-run-step': policy(
    'research-run-step',
    { kind: 'per-step-type', defaultAttempts: 3 },
    EXPONENTIAL_BACKOFF,
    ['runId', 'stepType', 'inputFingerprint', 'stepVersion'],
    ['projectId', 'runId', 'stepId', 'stepType', 'inputFingerprint', 'stepVersion'],
  ),
  'extraction-cell': policy(
    'extraction-cell',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['extractionRunId', 'documentId', 'columnKey'],
    ['projectId', 'runId', 'extractionRunId', 'documentId', 'columnKey'],
  ),
  screening: policy(
    'screening',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['runId', 'sourceId', 'criteriaVersion'],
    ['projectId', 'runId', 'sourceId', 'criteriaId', 'criteriaVersion'],
  ),
  stance: policy(
    'stance',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['runId', 'evidenceId'],
    ['projectId', 'runId', 'evidenceId'],
  ),
  synthesis: policy(
    'synthesis',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['runId', 'claimId', 'promptVersion'],
    ['projectId', 'runId', 'claimId', 'promptVersion'],
  ),
  derivation: policy(
    'derivation',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['runId', 'derivationType'],
    ['projectId', 'runId', 'derivationType'],
  ),
  'research-artifact-generate': policy(
    'research-artifact-generate',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['runId', 'artifactType', 'coverageSnapshotHash'],
    ['projectId', 'runId', 'artifactType', 'coverageSnapshotHash'],
  ),
  reaper: policy('reaper', fixed(1), null, ['olderThan'], ['olderThan']),
  'discovery-search': policy(
    'discovery-search',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['projectId', 'query', 'connectorIds'],
    ['projectId', 'connectorIds', 'query'],
  ),
  'identity-resolve': policy(
    'identity-resolve',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['identifier.scheme', 'identifier.value'],
    ['identifier'],
  ),
  'identity-merge': policy(
    'identity-merge',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['mergeCandidateId'],
    ['mergeCandidateId'],
  ),
  'connector-fetch': policy(
    'connector-fetch',
    fixed(5),
    EXPONENTIAL_BACKOFF,
    ['connectorId', 'externalId', 'purpose', 'freshnessTtl'],
    ['connectorId', 'externalId', 'purpose', 'freshnessTtl'],
  ),
  'external-record-refresh': policy(
    'external-record-refresh',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['externalRecordId', 'refreshInstant'],
    ['projectId', 'externalRecordId', 'refreshInstant'],
  ),
  'refmgr-import': policy(
    'refmgr-import',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['importSessionId'],
    ['projectId', 'importSessionId'],
  ),
  'billing-sync': policy(
    'billing-sync',
    fixed(5),
    EXPONENTIAL_BACKOFF,
    ['stripeEventId'],
    ['stripeEventId'],
  ),
  'billing-reconcile': policy(
    'billing-reconcile',
    fixed(1),
    null,
    ['dateBucket'],
    ['dateBucket'],
  ),
  'usage-rollup': policy(
    'usage-rollup',
    fixed(3),
    EXPONENTIAL_BACKOFF,
    ['orgId', 'period'],
    ['period'],
  ),
  'outbox-relay': policy(
    'outbox-relay',
    { kind: 'infinite' },
    EXPONENTIAL_BACKOFF,
    ['tick'],
    ['batchSize', 'tick'],
  ),
};

export function getQueuePolicy(queueName: QueueName): QueuePolicy {
  return QUEUE_REGISTRY[queueName];
}

export function listQueuePolicies(): readonly QueuePolicy[] {
  return Object.values(QUEUE_REGISTRY);
}

export function resolveAttempts(
  policy: QueuePolicy,
  stepType?: string,
): number | undefined {
  const { attempts } = policy;
  switch (attempts.kind) {
    case 'fixed':
      return attempts.attempts;
    case 'infinite':
      return undefined;
    case 'per-step-type':
      if (stepType === undefined) {
        return attempts.defaultAttempts;
      }
      return attempts.defaultAttempts;
  }
}
