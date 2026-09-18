import { createHash } from 'node:crypto';
import { canonicalJson } from '../../platform/queues/canonical-json';

export const RESEARCH_RUN_STEP_TYPES = ['retrieve', 'admit', 'evidence-extract'] as const;

export type ResearchRunStepType = (typeof RESEARCH_RUN_STEP_TYPES)[number];

export const RESEARCH_RUN_STEP_VERSION = 'v1';

export interface ResearchRunDagNode {
  readonly key: string;
  readonly stepType: ResearchRunStepType;
  readonly dependsOn: readonly string[];
  readonly query?: string;
  readonly documentVersionId?: string;
  readonly contentHash?: string;
}

export interface ResearchRunDag {
  readonly schemaVersion: 1;
  readonly presetCode: string;
  readonly nodes: readonly ResearchRunDagNode[];
}

export function isResearchRunStepType(value: string): value is ResearchRunStepType {
  return (RESEARCH_RUN_STEP_TYPES as readonly string[]).includes(value);
}

export function fingerprintResearchRunStep(input: {
  readonly runId: string;
  readonly key: string;
  readonly stepType: string;
  readonly stepVersion: string;
}): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

export function dagDepth(dag: ResearchRunDag): number {
  if (dag.nodes.length === 0) {
    return 0;
  }
  const byKey = indexNodes(dag.nodes);
  const memo = new Map<string, number>();
  const depthOf = (key: string): number => {
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const node = byKey.get(key);
    if (node === undefined) {
      return 0;
    }
    const depth =
      node.dependsOn.length === 0
        ? 1
        : 1 + Math.max(...node.dependsOn.map((dep) => depthOf(dep)));
    memo.set(key, depth);
    return depth;
  };
  return Math.max(...dag.nodes.map((node) => depthOf(node.key)));
}

export function parseResearchRunDag(value: unknown): ResearchRunDag {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ResearchRunDagError('custom DAG must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new ResearchRunDagError('custom DAG schemaVersion must be 1');
  }
  if (typeof record.presetCode !== 'string' || record.presetCode.length === 0) {
    throw new ResearchRunDagError('custom DAG presetCode is required');
  }
  if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
    throw new ResearchRunDagError('custom DAG must declare at least one node');
  }
  const nodes = record.nodes.map((item, index) => parseNode(item, index));
  assertUniqueKeys(nodes);
  assertDependenciesExist(nodes);
  assertAcyclic(nodes);
  return {
    schemaVersion: 1,
    presetCode: record.presetCode,
    nodes,
  };
}

export class ResearchRunDagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchRunDagError';
  }
}

function parseNode(value: unknown, index: number): ResearchRunDagNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ResearchRunDagError(`DAG node ${String(index)} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.key !== 'string' || record.key.length === 0) {
    throw new ResearchRunDagError(`DAG node ${String(index)} is missing key`);
  }
  if (typeof record.stepType !== 'string' || !isResearchRunStepType(record.stepType)) {
    throw new ResearchRunDagError(`DAG node ${record.key} has unknown stepType`);
  }
  if (!Array.isArray(record.dependsOn) || record.dependsOn.some((dep) => typeof dep !== 'string')) {
    throw new ResearchRunDagError(`DAG node ${record.key} dependsOn must be string[]`);
  }
  return {
    key: record.key,
    stepType: record.stepType,
    dependsOn: record.dependsOn as readonly string[],
    ...(typeof record.query === 'string' ? { query: record.query } : {}),
    ...(typeof record.documentVersionId === 'string'
      ? { documentVersionId: record.documentVersionId }
      : {}),
    ...(typeof record.contentHash === 'string' ? { contentHash: record.contentHash } : {}),
  };
}

function assertUniqueKeys(nodes: readonly ResearchRunDagNode[]): void {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (keys.has(node.key)) {
      throw new ResearchRunDagError(`duplicate DAG node key "${node.key}"`);
    }
    keys.add(node.key);
  }
}

function assertDependenciesExist(nodes: readonly ResearchRunDagNode[]): void {
  const keys = new Set(nodes.map((node) => node.key));
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!keys.has(dep)) {
        throw new ResearchRunDagError(`DAG node ${node.key} depends on missing "${dep}"`);
      }
    }
  }
}

function assertAcyclic(nodes: readonly ResearchRunDagNode[]): void {
  const byKey = indexNodes(nodes);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) {
      return;
    }
    if (visiting.has(key)) {
      throw new ResearchRunDagError('custom DAG contains a cycle');
    }
    visiting.add(key);
    const node = byKey.get(key);
    if (node !== undefined) {
      for (const dep of node.dependsOn) {
        visit(dep);
      }
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const node of nodes) {
    visit(node.key);
  }
}

function indexNodes(
  nodes: readonly ResearchRunDagNode[],
): Map<string, ResearchRunDagNode> {
  return new Map(nodes.map((node) => [node.key, node]));
}
