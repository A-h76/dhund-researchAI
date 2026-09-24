import { containsForbiddenLeak } from '../errors/leakage-guard';
import type { QueueName } from '../queues/queue-names';

export const METRIC_FAMILIES = [
  'api',
  'queue',
  'retrieval',
  'ai',
  'db',
  'ws',
  'webhook',
  'ingestion',
] as const;

export type MetricFamily = (typeof METRIC_FAMILIES)[number];

export const ROUTE_CLASSES = [
  'auth',
  'projects',
  'retrieval',
  'ingestion',
  'billing',
  'ai',
  'health',
  'other',
] as const;

export type RouteClass = (typeof ROUTE_CLASSES)[number];

export const RETRIEVAL_STAGES = ['vector', 'fts', 'rrf', 'rerank'] as const;
export type RetrievalStageLabel = (typeof RETRIEVAL_STAGES)[number];

export const WEBHOOK_OUTCOMES = [
  'accepted',
  'duplicate',
  'invalid_signature',
  'oversized',
  'malformed',
] as const;

export type WebhookOutcomeLabel = (typeof WEBHOOK_OUTCOMES)[number];

export const INGESTION_KINDS = ['upload', 'extract', 'chunk', 'embed'] as const;
export type IngestionKind = (typeof INGESTION_KINDS)[number];

export const WS_EVENTS = ['connection', 'join_denial'] as const;
export type WsEvent = (typeof WS_EVENTS)[number];

export class MetricLabelLeakError extends Error {
  constructor() {
    super('metric label rejected');
    this.name = 'MetricLabelLeakError';
  }
}

export function assertSafeLabels(labels: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(labels)) {
    if (containsForbiddenLeak(key) || containsForbiddenLeak(value)) {
      throw new MetricLabelLeakError();
    }
  }
}

export function routeClassForPath(path: string | undefined): RouteClass {
  const value = (path ?? '').split('?')[0] ?? '';
  if (value.includes('/retrieval')) {
    return 'retrieval';
  }
  if (value.includes('/documents') || value.includes('/uploads')) {
    return 'ingestion';
  }
  if (value.includes('/conversations') || value.includes('/capabilities')) {
    return 'ai';
  }
  if (value.includes('/webhooks') || value.includes('/billing')) {
    return 'billing';
  }
  if (value.includes('/auth')) {
    return 'auth';
  }
  if (value.includes('/projects') || value.includes('/orgs') || value.includes('/memberships')) {
    return 'projects';
  }
  if (value.includes('/health') || value === '/' || value.length === 0) {
    return 'health';
  }
  return 'other';
}

export type ApiLabels = { readonly routeClass: RouteClass };
export type QueueLabels = { readonly queue: QueueName };
export type RetrievalLabels = { readonly stage: RetrievalStageLabel };
export type AiLabels = { readonly capability: string };
export type DbLabels = { readonly signal: 'pool' | 'slow_query' };
export type WsLabels = { readonly event: WsEvent };
export type WebhookLabels = { readonly outcome: WebhookOutcomeLabel };
export type IngestionLabels = { readonly kind: IngestionKind };
