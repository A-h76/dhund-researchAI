import { Inject, Injectable } from '@nestjs/common';
import { COUNTER_SERVICE, type CounterService } from '../../l0/ports';
import type { QueueName } from '../queues/queue-names';
import {
  buildEmbedBackfillGlobalCounterKey,
  buildGlobalBatchCounterKey,
  buildOrgBatchCounterKey,
  buildOrgUploadCounterKey,
  buildOcrPoolCounterKey,
  effectiveGlobalBatchLimit,
  EMBED_BACKFILL_GLOBAL_CAP,
  OCR_POOL_CEILING,
  GATE_COUNTER_TTL_SECONDS,
  PER_ORG_BATCH_CONCURRENCY_DEFAULT,
  UPLOAD_CONCURRENCY_DEFAULT,
  isUploadGatedQueue,
} from './concurrency-gate.config';
import { ConcurrencyMetrics } from './concurrency-metrics';

export type GateSlotKind = 'batch' | 'upload' | 'embed-backfill';

export interface AcquiredGateSlot {
  readonly kind: GateSlotKind;
  readonly orgId: string;
  readonly keys: readonly string[];
}

@Injectable()
export class BatchConcurrencyGateService {
  constructor(
    @Inject(COUNTER_SERVICE) private readonly counters: CounterService,
    private readonly metrics: ConcurrencyMetrics,
  ) {}

  async getOrgInflight(orgId: string): Promise<number> {
    return this.counters.get(buildOrgBatchCounterKey(orgId));
  }

  async getGlobalInflight(): Promise<number> {
    return this.counters.get(buildGlobalBatchCounterKey());
  }

  isOrgOverHardLimit(inflight: number, limit: number = PER_ORG_BATCH_CONCURRENCY_DEFAULT): boolean {
    return inflight >= limit;
  }

  async tryAcquireImmediate(
    orgId: string,
    queueName: QueueName,
    orgLimit: number = PER_ORG_BATCH_CONCURRENCY_DEFAULT,
  ): Promise<AcquiredGateSlot | null> {
    if (queueName === 'embed-backfill') {
      return this.tryAcquireEmbedBackfill(orgId);
    }

    const orgKey = buildOrgBatchCounterKey(orgId);
    const globalKey = buildGlobalBatchCounterKey();
    const uploadKey = isUploadGatedQueue(queueName) ? buildOrgUploadCounterKey(orgId) : null;
    const ocrKey = queueName === 'ocr' ? buildOcrPoolCounterKey() : null;

    const orgInflight = await this.counters.get(orgKey);
    if (this.isOrgOverHardLimit(orgInflight, orgLimit)) {
      return null;
    }

    if (uploadKey !== null) {
      const uploadInflight = await this.counters.get(uploadKey);
      if (uploadInflight >= UPLOAD_CONCURRENCY_DEFAULT) {
        return null;
      }
    }

    if (ocrKey !== null) {
      const ocrInflight = await this.counters.get(ocrKey);
      if (ocrInflight >= OCR_POOL_CEILING) {
        return null;
      }
    }

    const acquiredOrg = await this.counters.incrementIfBelow(
      orgKey,
      orgLimit,
      GATE_COUNTER_TTL_SECONDS,
    );
    if (!acquiredOrg) {
      return null;
    }

    const acquiredGlobal = await this.counters.incrementIfBelow(
      globalKey,
      effectiveGlobalBatchLimit(),
      GATE_COUNTER_TTL_SECONDS,
    );
    if (!acquiredGlobal) {
      await this.counters.decrement(orgKey);
      return null;
    }

    if (uploadKey !== null) {
      const acquiredUpload = await this.counters.incrementIfBelow(
        uploadKey,
        UPLOAD_CONCURRENCY_DEFAULT,
        GATE_COUNTER_TTL_SECONDS,
      );
      if (!acquiredUpload) {
        await this.counters.decrement(orgKey);
        await this.counters.decrement(globalKey);
        return null;
      }
    }

    if (ocrKey !== null) {
      const acquiredOcr = await this.counters.incrementIfBelow(
        ocrKey,
        OCR_POOL_CEILING,
        GATE_COUNTER_TTL_SECONDS,
      );
      if (!acquiredOcr) {
        await this.counters.decrement(orgKey);
        await this.counters.decrement(globalKey);
        if (uploadKey !== null) {
          await this.counters.decrement(uploadKey);
        }
        return null;
      }
    }

    const keys = [
      orgKey,
      globalKey,
      ...(uploadKey !== null ? [uploadKey] : []),
      ...(ocrKey !== null ? [ocrKey] : []),
    ];
    await this.refreshMetrics(orgId);
    return { kind: 'batch', orgId, keys };
  }

  async release(slot: AcquiredGateSlot): Promise<void> {
    for (const key of slot.keys) {
      await this.counters.decrement(key);
    }
    await this.refreshMetrics(slot.orgId);
  }

  private async tryAcquireEmbedBackfill(orgId: string): Promise<AcquiredGateSlot | null> {
    const key = buildEmbedBackfillGlobalCounterKey();
    const acquired = await this.counters.incrementIfBelow(
      key,
      EMBED_BACKFILL_GLOBAL_CAP,
      GATE_COUNTER_TTL_SECONDS,
    );
    if (!acquired) {
      return null;
    }

    await this.refreshMetrics(orgId);
    return { kind: 'embed-backfill', orgId, keys: [key] };
  }

  private async refreshMetrics(orgId: string): Promise<void> {
    this.metrics.recordOrgInflight(await this.getOrgInflight(orgId));
    this.metrics.recordGlobalInflight(await this.getGlobalInflight());
  }
}
