import { Injectable } from '@nestjs/common';
import { SLOW_QUERY_THRESHOLD_MS } from '../../l0/ports/query-observer.port';
import type { QueueName } from '../queues/queue-names';
import { AlertingService } from './alerting.service';
import {
  assertSafeLabels,
  type IngestionKind,
  type MetricFamily,
  type RetrievalStageLabel,
  type RouteClass,
  type WebhookOutcomeLabel,
} from './metric-labels';

export const ERROR_RATE_SPIKE_MIN_SAMPLES = 4;
export const ERROR_RATE_SPIKE_RATIO = 0.5;

export interface MetricSample {
  readonly family: MetricFamily;
  readonly name: string;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
}

interface ApiWindow {
  requests: number;
  errors: number;
}

@Injectable()
export class MetricsSurface {
  private readonly samples: MetricSample[] = [];
  private readonly apiWindows = new Map<RouteClass, ApiWindow>();
  private provenanceBreaks = 0;

  constructor(private readonly alerting: AlertingService) {}

  recordApi(input: {
    readonly routeClass: RouteClass;
    readonly latencyMs: number;
    readonly error: boolean;
  }): void {
    const labels = { routeClass: input.routeClass };
    this.push('api', 'latency_ms', input.latencyMs, labels);
    this.push('api', input.error ? 'errors' : 'requests', 1, labels);
    this.noteApiOutcome(input.routeClass, input.error);
  }

  recordQueueDepth(input: {
    readonly queue: QueueName;
    readonly depth: number;
    readonly dlq: number;
  }): void {
    const labels = { queue: input.queue };
    this.push('queue', 'depth', input.depth, labels);
    this.push('queue', 'dlq', input.dlq, labels);
    if (input.dlq > 0) {
      this.alerting.signal('dlq_depth');
    }
  }

  recordQueueJob(input: {
    readonly queue: QueueName;
    readonly waitMs: number;
    readonly processMs: number;
    readonly retry: number;
  }): void {
    const labels = { queue: input.queue };
    this.push('queue', 'wait_ms', input.waitMs, labels);
    this.push('queue', 'process_ms', input.processMs, labels);
    this.push('queue', 'retry', input.retry, labels);
  }

  recordRetrieval(input: {
    readonly stage: RetrievalStageLabel;
    readonly latencyMs: number;
  }): void {
    this.push('retrieval', 'stage_latency_ms', input.latencyMs, { stage: input.stage });
  }

  recordRetrievalShortfall(count: number): void {
    this.push('retrieval', 'shortfall', count, { stage: 'rerank' });
  }

  recordAi(input: {
    readonly capability: string;
    readonly costMicros: number;
    readonly latencyMs: number;
    readonly tokens: number;
  }): void {
    const labels = { capability: input.capability };
    this.push('ai', 'cost_micros', input.costMicros, labels);
    this.push('ai', 'latency_ms', input.latencyMs, labels);
    this.push('ai', 'tokens', input.tokens, labels);
  }

  recordDbPool(utilisation: number): void {
    this.push('db', 'pool_utilisation', utilisation, { signal: 'pool' });
  }

  recordSlowQuery(durationMs: number): void {
    this.push('db', 'slow_query', 1, { signal: 'slow_query' });
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      this.alerting.signal('slow_query');
    }
  }

  recordWsConnection(delta: number): void {
    this.push('ws', 'connections', delta, { event: 'connection' });
  }

  recordWsJoinDenial(): void {
    this.push('ws', 'join_denials', 1, { event: 'join_denial' });
  }

  recordWebhook(outcome: WebhookOutcomeLabel): void {
    this.push('webhook', 'outcomes', 1, { outcome });
  }

  recordIngestion(kind: IngestionKind, count: number): void {
    this.push('ingestion', 'throughput', count, { kind });
  }

  recordBrokenProvenance(count: number): void {
    if (count <= 0) {
      return;
    }
    this.provenanceBreaks += count;
    if (this.provenanceBreaks > 0) {
      this.alerting.signal('broken_provenance');
    }
  }

  snapshot(): readonly MetricSample[] {
    return this.samples.map((sample) => ({ ...sample, labels: { ...sample.labels } }));
  }

  familiesEmitted(): readonly MetricFamily[] {
    return [...new Set(this.samples.map((sample) => sample.family))];
  }

  private noteApiOutcome(routeClass: RouteClass, error: boolean): void {
    const window = this.apiWindows.get(routeClass) ?? { requests: 0, errors: 0 };
    window.requests += 1;
    if (error) {
      window.errors += 1;
    }
    this.apiWindows.set(routeClass, window);
    if (
      window.requests >= ERROR_RATE_SPIKE_MIN_SAMPLES &&
      window.errors / window.requests > ERROR_RATE_SPIKE_RATIO
    ) {
      this.alerting.signal('error_rate_spike');
    }
  }

  private push(
    family: MetricFamily,
    name: string,
    value: number,
    labels: Readonly<Record<string, string>>,
  ): void {
    assertSafeLabels(labels);
    this.samples.push({ family, name, value, labels: { ...labels } });
  }
}
