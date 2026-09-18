import { Inject, Injectable } from '@nestjs/common';
import {
  RESEARCH_RUN_STORE,
  type ResearchRunFailedReason,
  type ResearchRunRecord,
  type ResearchRunStore,
} from '../l0/ports';
import { generateId } from '../platform/ids/uuid-v7';
import {
  dagDepth,
  fingerprintResearchRunStep,
  RESEARCH_RUN_STEP_VERSION,
} from './presets/research-run-dag';
import { resolveResearchRunPreset } from './presets/resolve-preset';
import { ResearchRunMetrics } from './research-run.metrics';

export type PlanningDecision =
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: ResearchRunFailedReason };

@Injectable()
export class ResearchRunPlannerService {
  constructor(
    @Inject(RESEARCH_RUN_STORE) private readonly store: ResearchRunStore,
    private readonly metrics: ResearchRunMetrics,
  ) {}

  async plan(run: ResearchRunRecord): Promise<PlanningDecision> {
    const resolved = resolveResearchRunPreset({
      preset: run.preset,
      customDag: run.customDag,
    });
    if (resolved.kind === 'failed') {
      return resolved;
    }

    const idByKey = new Map<string, string>();
    for (const node of resolved.dag.nodes) {
      idByKey.set(node.key, generateId());
    }

    const seeds = resolved.dag.nodes.map((node) => {
      const id = idByKey.get(node.key) ?? generateId();
      return {
        id,
        stepType: node.stepType,
        dependsOnStepIds: node.dependsOn.flatMap((key) => {
          const depId = idByKey.get(key);
          return depId === undefined ? [] : [depId];
        }),
        inputFingerprint: fingerprintResearchRunStep({
          runId: run.id,
          key: node.key,
          stepType: node.stepType,
          stepVersion: RESEARCH_RUN_STEP_VERSION,
        }),
        stepVersion: RESEARCH_RUN_STEP_VERSION,
        state: node.dependsOn.length === 0 ? ('READY' as const) : ('PENDING' as const),
      };
    });

    await this.store.createSteps(run.id, seeds);
    this.metrics.recordDagDepth(dagDepth(resolved.dag));
    return { kind: 'ready' };
  }
}
