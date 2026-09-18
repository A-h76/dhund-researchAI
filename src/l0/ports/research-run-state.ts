/**
 * ResearchRun state machine (Phase 7 §4 / DHB-64).
 *
 * FAILED is narrow: only planning failure or zero eligible sources.
 * Task-level failures reduce coverage and terminate as COMPLETED_PARTIAL.
 *
 * Forbidden: any backward transition; anything out of a terminal state;
 * RUNNING → COMPLETED without COMPLETING; PLANNING → PAUSED_*.
 */

export const RESEARCH_RUN_STATES = [
  'CREATED',
  'PLANNING',
  'RUNNING',
  'PAUSED_BUDGET',
  'PAUSED_MANUAL',
  'COMPLETING',
  'COMPLETED',
  'COMPLETED_PARTIAL',
  'FAILED',
  'CANCELLED',
] as const;

export type ResearchRunStateName = (typeof RESEARCH_RUN_STATES)[number];

export const RESEARCH_RUN_TERMINAL_STATES = [
  'COMPLETED',
  'COMPLETED_PARTIAL',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly ResearchRunStateName[];

export type ResearchRunTerminalState = (typeof RESEARCH_RUN_TERMINAL_STATES)[number];

export const RESEARCH_RUN_NON_TERMINAL_STATES = [
  'CREATED',
  'PLANNING',
  'RUNNING',
  'PAUSED_BUDGET',
  'PAUSED_MANUAL',
  'COMPLETING',
] as const satisfies readonly ResearchRunStateName[];

export type ResearchRunNonTerminalState =
  (typeof RESEARCH_RUN_NON_TERMINAL_STATES)[number];

/** Reasons allowed for entering FAILED — nothing else may. */
export const RESEARCH_RUN_FAILED_REASONS = [
  'planning_failure',
  'zero_eligible_sources',
] as const;

export type ResearchRunFailedReason = (typeof RESEARCH_RUN_FAILED_REASONS)[number];

export const RESEARCH_RUN_STATE_TRANSITIONS: Readonly<
  Record<ResearchRunStateName, readonly ResearchRunStateName[]>
> = {
  CREATED: ['PLANNING', 'CANCELLED'],
  PLANNING: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['COMPLETING', 'PAUSED_BUDGET', 'PAUSED_MANUAL', 'CANCELLED'],
  PAUSED_BUDGET: ['RUNNING', 'CANCELLED'],
  PAUSED_MANUAL: ['RUNNING', 'CANCELLED'],
  COMPLETING: ['COMPLETED', 'COMPLETED_PARTIAL', 'CANCELLED'],
  COMPLETED: [],
  COMPLETED_PARTIAL: [],
  FAILED: [],
  CANCELLED: [],
};

export function isResearchRunState(value: string): value is ResearchRunStateName {
  return (RESEARCH_RUN_STATES as readonly string[]).includes(value);
}

export function isResearchRunTerminal(
  state: ResearchRunStateName,
): state is ResearchRunTerminalState {
  return (RESEARCH_RUN_TERMINAL_STATES as readonly string[]).includes(state);
}

export function isResearchRunNonTerminal(
  state: ResearchRunStateName,
): state is ResearchRunNonTerminalState {
  return (RESEARCH_RUN_NON_TERMINAL_STATES as readonly string[]).includes(state);
}

export function canTransitionResearchRun(
  from: ResearchRunStateName,
  to: ResearchRunStateName,
): boolean {
  if (from === to) {
    return false;
  }
  return RESEARCH_RUN_STATE_TRANSITIONS[from].includes(to);
}

export function assertCanEnterFailed(reason: ResearchRunFailedReason): void {
  if (!(RESEARCH_RUN_FAILED_REASONS as readonly string[]).includes(reason)) {
    throw new ResearchRunTransitionError(
      'RUNNING',
      'FAILED',
      `FAILED is narrow; reason "${String(reason)}" is not allowed`,
    );
  }
}

export class ResearchRunTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
    message?: string,
  ) {
    super(message ?? `Forbidden research-run transition ${from} -> ${to}`);
    this.name = 'ResearchRunTransitionError';
  }
}
